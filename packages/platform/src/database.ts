/**
 * Database access. Requests run on a pool that logs in with DATABASE_URL and switches to the
 * `audit_app` role, which may only INSERT and SELECT the trail. Migrations and retention purges
 * open their own short-lived connections as the login role.
 */
import { fileURLToPath } from "node:url"
import { relations } from "@audit/db/relations"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import { migrate } from "drizzle-orm/effect-postgres/migrator"
import { Context, Effect, Layer, type Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { pgTypes } from "./pg-types.ts"

export type Database = PgDrizzle.EffectPgDatabase<typeof relations> & {
  readonly $client: PgClient.PgClient
}

/** Drizzle over the same `PgClient` as `SqlClient`, so both share transactions. */
export class Db extends Context.Service<Db, Database>()("@audit/platform/Db") {}

export const APP_ROLE = "audit_app"
export const RETENTION_ROLE = "audit_retention"

export interface PoolOptions {
  readonly url: Redacted.Redacted
  /** Postgres role every connection switches to; omit to stay the login role. */
  readonly role?: string
  readonly maxConnections?: number
}

export const pgLayer = (options: PoolOptions) =>
  PgClient.layer({
    url: options.url,
    applicationName: "audit",
    maxConnections: options.maxConnections ?? 10,
    types: pgTypes,
    ...(options.role === undefined ? {} : { startupParameters: { role: options.role } }),
  })

const dbLayer = Layer.effect(Db, PgDrizzle.make({ relations })).pipe(
  Layer.provide(PgDrizzle.DefaultServices),
)

/** `Db`, `SqlClient` and `PgClient` for one pool. */
export const databaseLayer = (options: PoolOptions) =>
  dbLayer.pipe(Layer.provideMerge(pgLayer(options)))

/** Overridable for the compiled binary, which ships migrations next to it. */
export const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../../db/drizzle", import.meta.url))

/**
 * Applies pending migrations under a transaction-scoped advisory lock, so instances starting
 * together run them once.
 */
export const runMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const db = yield* Db
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`select pg_advisory_xact_lock(hashtext('audit:migrations'))`
      yield* migrate(db, { migrationsFolder })
    }),
  )
})

/** Migrates with a short-lived connection as the login role. */
export const migrateDatabase = (url: Redacted.Redacted) =>
  runMigrations.pipe(Effect.provide(databaseLayer({ url, maxConnections: 1 })))
