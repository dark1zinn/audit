/**
 * Background jobs on pg-boss. Enqueuing joins the caller's transaction, so a job exists only if the
 * command that created it commits.
 */
import { Cause, Context, Effect, Layer, Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { type Db as BossDb, PgBoss, type QueueOptions, type SendOptions } from "pg-boss"
import { APP_ROLE } from "./database.ts"

export interface JobDefinition<Name extends string = string, S extends Schema.Top = Schema.Top> {
  readonly name: Name
  readonly schema: S
  readonly queue: QueueOptions
}

export const defineJob = <const Name extends string, S extends Schema.Top>(
  name: Name,
  schema: S,
  queue: QueueOptions = {},
): JobDefinition<Name, S> => ({ name, schema, queue })

export type JobData<J extends JobDefinition> = J["schema"]["Type"]

export interface EnqueueOptions {
  readonly startAfter?: Date | number
  readonly singletonKey?: string
  /** Debounce: at most one job per key within this many seconds. */
  readonly singletonSeconds?: number
}

export interface JobsShape {
  /** Enqueues inside the current transaction when there is one. */
  readonly enqueue: <J extends JobDefinition>(
    job: J,
    data: JobData<J>,
    options?: EnqueueOptions,
  ) => Effect.Effect<void, never, SqlClient.SqlClient>
  /** Starts a worker; failures are logged and retried by pg-boss. */
  readonly work: <J extends JobDefinition, R>(
    job: J,
    handler: (data: JobData<J>) => Effect.Effect<void, unknown, R>,
    options?: { readonly batchSize?: number; readonly pollingIntervalSeconds?: number },
  ) => Effect.Effect<void, never, R>
  readonly schedule: <J extends JobDefinition>(
    job: J,
    cron: string,
    data: JobData<J>,
  ) => Effect.Effect<void>
}

export class Jobs extends Context.Service<Jobs, JobsShape>()("@audit/platform/Jobs") {}

const encode = <J extends JobDefinition>(job: J, data: JobData<J>): object =>
  Schema.encodeUnknownSync(job.schema as Schema.Codec<unknown, unknown>)(data) as object

/** pg-boss SQL routed through the Effect SqlClient of the given fiber context (and its transaction). */
const transactionDb = (sql: SqlClient.SqlClient, context: Context.Context<never>): BossDb => ({
  executeSql: (text, values) =>
    Effect.runPromiseWith(context)(
      sql
        .unsafe<Record<string, unknown>>(text, values as ReadonlyArray<unknown>)
        .pipe(Effect.map((rows) => ({ rows: [...rows] }))),
    ),
})

/**
 * pg-boss runs its own pool as the login role. Its schema is shared with `audit_app` so jobs can
 * be enqueued from request transactions.
 */
export const pgBossLayer = (options: {
  readonly url: Redacted.Redacted
  readonly jobs: ReadonlyArray<JobDefinition>
}) =>
  Layer.effect(
    Jobs,
    Effect.gen(function* () {
      const boss = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const boss = new PgBoss({
            connectionString: Redacted.value(options.url),
            schema: "pgboss",
            max: 4,
          })
          boss.on("error", (error) => console.error("pg-boss", error))
          await boss.start()
          const db = boss.getDb()
          await db.executeSql(`GRANT USAGE ON SCHEMA pgboss TO ${APP_ROLE}`)
          await db.executeSql(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO ${APP_ROLE}`,
          )
          await db.executeSql(
            `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO ${APP_ROLE}`,
          )
          await db.executeSql(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO ${APP_ROLE}`)
          for (const job of options.jobs) {
            if ((await boss.getQueue(job.name)) === null)
              await boss.createQueue(job.name, job.queue)
          }
          return boss
        }),
        (boss) => Effect.promise(() => boss.stop({ graceful: true, timeout: 30_000, close: true })),
      )

      return Jobs.of({
        enqueue: (job, data, enqueueOptions) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const context = yield* Effect.context<never>()
            const send: SendOptions = { db: transactionDb(sql, context) }
            if (enqueueOptions?.startAfter !== undefined)
              send.startAfter = enqueueOptions.startAfter
            if (enqueueOptions?.singletonKey !== undefined)
              send.singletonKey = enqueueOptions.singletonKey
            if (enqueueOptions?.singletonSeconds !== undefined) {
              send.singletonSeconds = enqueueOptions.singletonSeconds
            }
            yield* Effect.promise(() => boss.send(job.name, encode(job, data), send))
          }),
        work: <J extends JobDefinition, R>(
          job: J,
          handler: (data: JobData<J>) => Effect.Effect<void, unknown, R>,
          workOptions?: { readonly batchSize?: number; readonly pollingIntervalSeconds?: number },
        ) =>
          Effect.gen(function* () {
            const context = yield* Effect.context<R>()
            const decode = Schema.decodeUnknownEffect(
              job.schema as Schema.Codec<JobData<J>, unknown>,
            )
            yield* Effect.promise(() =>
              boss.work(
                job.name,
                {
                  batchSize: workOptions?.batchSize ?? 1,
                  pollingIntervalSeconds: workOptions?.pollingIntervalSeconds ?? 2,
                },
                async (batch) => {
                  for (const item of batch) {
                    const exit = await Effect.runPromiseExitWith(context)(
                      decode(item.data).pipe(
                        Effect.flatMap(handler),
                        Effect.withSpan(`job ${job.name}`),
                      ),
                    )
                    // Throwing marks the job failed; pg-boss retries it per the queue policy.
                    if (exit._tag === "Failure") throw new Error(Cause.pretty(exit.cause))
                  }
                },
              ),
            )
          }),
        schedule: (job, cron, data) =>
          Effect.promise(() => boss.schedule(job.name, cron, encode(job, data), { tz: "UTC" })),
      })
    }),
  )

export interface RecordedJob {
  readonly name: string
  readonly data: unknown
  readonly options: EnqueueOptions | undefined
}

export interface RecordingJobs {
  readonly enqueued: RecordedJob[]
  readonly layer: Layer.Layer<Jobs>
}

/** In-memory jobs for tests: records what was enqueued, never runs it. */
export const recordingJobs = (): RecordingJobs => {
  const enqueued: RecordedJob[] = []
  const layer = Layer.succeed(
    Jobs,
    Jobs.of({
      enqueue: (job, data, options) =>
        Effect.sync(() => void enqueued.push({ name: job.name, data, options })),
      work: () => Effect.void,
      schedule: () => Effect.void,
    }),
  )
  return { enqueued, layer }
}
