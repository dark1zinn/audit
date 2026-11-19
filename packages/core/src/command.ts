/**
 * Every write is a named command: decode the input, check permission, run in one transaction with
 * its audit entry and reference changes, then publish events after commit. Nothing else writes.
 */
import { idempotencyKeys } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { ValidationError } from "@audit/domain/errors"
import { Db } from "@audit/platform/database"
import { and, eq, gt } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { EffectDrizzleError, EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { SqlClient, type SqlError } from "effect/sql"
import { EventBus } from "./event-bus.ts"
import { CommandScope, writeTrail } from "./trail.ts"

export interface CommandSpec<I, IE, O, OE, E, R, EA, RA> {
  readonly input: Schema.Codec<I, IE>
  readonly output: Schema.Codec<O, OE>
  /** Permission check, before the transaction. */
  readonly authorize: (input: I) => Effect.Effect<void, EA, RA>
  /** The change itself; runs inside the transaction. */
  readonly run: (input: I) => Effect.Effect<O, E, R>
}

export interface ExecuteOptions {
  /** Safe client retries: the same key from the same actor returns the stored result for 24 h. */
  readonly idempotencyKey?: string
}

export interface Command<Name extends string, I, IE, O, E, R> {
  readonly name: Name
  readonly input: Schema.Codec<I, IE>
  readonly output: Schema.Codec<O, unknown>
  readonly execute: (input: I, options?: ExecuteOptions) => Effect.Effect<O, E, R>
  /** For untrusted callers (AI tools): decodes first, failing with `ValidationError`. */
  readonly executeUnknown: (
    input: unknown,
    options?: ExecuteOptions,
  ) => Effect.Effect<O, E | ValidationError, R>
}

const IDEMPOTENCY_HOURS = 24

/** Database failures are defects: commands map the ones they expect (e.g. unique clashes) themselves. */
type InfraError = SqlError.SqlError | EffectDrizzleQueryError | EffectDrizzleError
const infraTags: ReadonlyArray<string> = [
  "SqlError",
  "EffectDrizzleQueryError",
  "EffectDrizzleError",
]
const isInfraError = (error: unknown): error is InfraError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  infraTags.includes(String(error._tag))

/** True when a database error is a unique-constraint violation (SQLSTATE 23505). */
export const isUniqueViolation = (error: unknown): boolean => {
  const pending: Array<unknown> = [error]
  const seen = new Set<unknown>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current !== "object" || current === null || seen.has(current)) continue
    seen.add(current)
    const node = current as Record<string, unknown>
    if (node._tag === "UniqueViolation" || node.code === "23505") return true
    // Drizzle wraps the SqlError in an Effect Cause: follow causes, reasons and their errors.
    pending.push(node.cause, node.reason, node.error)
    if (Array.isArray(node.reasons)) pending.push(...node.reasons)
  }
  return false
}

export const make = <const Name extends string, I, IE, O, OE, E, R, EA, RA>(
  name: Name,
  spec: CommandSpec<I, IE, O, OE, E, R, EA, RA>,
): Command<
  Name,
  I,
  IE,
  O,
  Exclude<E | EA, InfraError>,
  Exclude<R, CommandScope> | RA | CurrentActor | Db | SqlClient.SqlClient | EventBus
> => {
  const outputJson = Schema.toCodecJson(spec.output)

  type Requirements =
    | Exclude<R, CommandScope>
    | RA
    | CurrentActor
    | Db
    | SqlClient.SqlClient
    | EventBus
  const execute = (
    input: I,
    options?: ExecuteOptions,
  ): Effect.Effect<O, Exclude<E | EA, InfraError>, Requirements> =>
    Effect.gen(function* () {
      const actor = yield* CurrentActor
      const db = yield* Db
      const sql = yield* SqlClient.SqlClient
      const bus = yield* EventBus

      yield* spec.authorize(input)

      const userId = actorUserId(actor)
      const key =
        options?.idempotencyKey !== undefined && userId !== null ? options.idempotencyKey : null
      if (key !== null && userId !== null) {
        const [stored] = yield* db
          .select({ command: idempotencyKeys.command, result: idempotencyKeys.result })
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.actorId, userId),
              eq(idempotencyKeys.key, key),
              gt(idempotencyKeys.expiresAt, new Date()),
            ),
          )
          .pipe(Effect.orDie)
        if (stored !== undefined && stored.command === name) {
          return yield* Schema.decodeUnknownEffect(outputJson)(stored.result).pipe(Effect.orDie)
        }
      }

      const scope = CommandScope.of({ name, events: [], trailEntries: 0 })
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const output = yield* spec.run(input)
          if (scope.trailEntries === 0) yield* writeTrail({ action: name })
          if (key !== null && userId !== null) {
            const encoded = yield* Schema.encodeEffect(outputJson)(output).pipe(Effect.orDie)
            yield* db
              .insert(idempotencyKeys)
              .values({
                key,
                actorId: userId,
                command: name,
                result: encoded,
                expiresAt: new Date(Date.now() + IDEMPOTENCY_HOURS * 3_600_000),
              })
              .onConflictDoNothing()
              .pipe(Effect.orDie)
          }
          return output
        }).pipe(Effect.provideService(CommandScope, scope)),
      )
      yield* bus.publish(scope.events)
      return result
    }).pipe(
      // Infrastructure failures become defects; the cast drops them from the error type.
      Effect.catchIf(isInfraError, (error) => Effect.die(error)),
      Effect.withSpan(`command ${name}`),
    ) as Effect.Effect<O, Exclude<E | EA, InfraError>, Requirements>

  return {
    name,
    input: spec.input,
    output: spec.output as Schema.Codec<O, unknown>,
    execute,
    executeUnknown: (input, options) =>
      Schema.decodeUnknownEffect(spec.input)(input).pipe(
        Effect.mapError((issue) => new ValidationError({ message: issue.message })),
        Effect.flatMap((decoded) => execute(decoded, options)),
      ),
  }
}
