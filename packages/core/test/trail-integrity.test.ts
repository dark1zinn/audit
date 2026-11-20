import { writeTrail } from "@audit/core/trail"
import { chainTrail } from "@audit/core/trail-chain"
import { verifyTrail } from "@audit/core/trail-queries"
import { loadTrailKey } from "@audit/core/trail-key"
import { Secrets, makeSecrets } from "@audit/platform/crypto"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { runAs, setupWorkspace, system } from "@audit/testkit/fixtures"
import { SqlClient } from "effect/sql"
import { Cause, Effect, Exit, Redacted } from "effect"
import { afterEach, describe, expect, test } from "bun:test"

/** A fresh database with a workspace and five trail entries, all chained; each test owns one. */
const created: TestDatabase[] = []
const seeded = async (): Promise<TestDatabase> => {
  const database = await makeTestDatabase()
  created.push(database)
  await setupWorkspace(database)
  await runAs(
    database,
    system,
  )(Effect.forEach([1, 2, 3, 4, 5], (n) => writeTrail({ action: `test.seed.${n}` })))
  await runAs(database, system)(chainTrail)
  return database
}

const verify = (database: TestDatabase, options: Parameters<typeof verifyTrail>[0] = {}) =>
  runAs(database, system)(verifyTrail(options))

// Each database holds its own pools; dropping them keeps the server under its connection limit.
afterEach(async () => {
  for (const database of created.splice(0)) await database.drop()
})

describe("trail integrity", () => {
  test("a forged row whose unkeyed chain was rebuilt is detected", async () => {
    const database = await seeded()
    expect((await verify(database)).ok).toBe(true)
    const [target] =
      await database.superuser`select chain_pos from trail_events order by chain_pos limit 1 offset 2`
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`update trail_events set action = 'forged' where chain_pos = ${target.chain_pos}`
    // An attacker with DB write access rebuilds the unkeyed SHA-256 chain from the forged row onward.
    const tail =
      await database.superuser`select chain_pos from trail_events where chain_pos >= ${target.chain_pos} order by chain_pos`
    for (const row of tail) {
      await database.superuser`update trail_events set prev_hash = (select hash from trail_events where chain_pos = ${row.chain_pos} - 1) where chain_pos = ${row.chain_pos}`
      await database.superuser`update trail_events t set hash = trail_event_hash(t) where chain_pos = ${row.chain_pos}`
    }
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    expect((await verify(database)).ok).toBe(false)
  })

  test("tail truncation is detected against an expected head", async () => {
    const database = await seeded()
    const [last] =
      await database.superuser`select chain_pos, hash from trail_events order by chain_pos desc limit 1`
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`delete from trail_events where chain_pos = ${last.chain_pos}`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    expect((await verify(database)).ok).toBe(true)
    const withHead = await verify(database, {
      expectedHead: { chainPos: Number(last.chain_pos), hash: last.hash },
    })
    expect(withHead.ok).toBe(false)
    expect(withHead.expectedHeadFound).toBe(false)
  })

  test("the app login cannot delete trail rows directly", async () => {
    const database = await seeded()
    const attempt = database.runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe("set role audit_app; delete from trail_events")
      }).pipe(Effect.exit),
    )
    expect(Exit.isFailure(await attempt)).toBe(true)
  })

  test("retention, run as the app login, deletes only rows past the cutoff", async () => {
    const database = await seeded()
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`update trail_events set at = now() - interval '40 days' where chain_pos <= 2`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    const purged = await database.runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql.unsafe("set local role audit_app")
            return yield* sql<{ purged: string }>`select trail_purge(30) as purged`
          }),
        )
      }),
    )
    expect(Number(purged[0]?.purged)).toBe(2)
    const [remaining] = await database.superuser`select count(*)::int as n from trail_events`
    // setupWorkspace writes 2 entries and seeding 5 more: 7 in all, 2 of them purged.
    expect(remaining.n).toBe(5)
    // The chain still verifies: the first remaining row is the start of the trail.
    expect((await verify(database)).ok).toBe(true)
  })

  test("retention below the 30-day floor is refused for the app login", async () => {
    const database = await seeded()
    const attempt = database.runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql.unsafe("set local role audit_app")
            return yield* sql`select trail_purge(1) as purged`
          }),
        )
      }).pipe(Effect.exit),
    )
    expect(Exit.isFailure(await attempt)).toBe(true)
  })

  test("a prefix removed outside retention is detected", async () => {
    const database = await seeded()
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`delete from trail_events where chain_pos <= 2`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    expect((await verify(database)).ok).toBe(false)
  })

  test("an anchor removed after a purge is detected", async () => {
    const database = await seeded()
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`update trail_events set at = now() - interval '40 days' where chain_pos <= 2`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    await database.runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql.unsafe("set local role audit_app")
            return yield* sql`select trail_purge(30) as purged`
          }),
        )
      }),
    )
    expect((await verify(database)).ok).toBe(true)
    await database.superuser`delete from trail_anchor`
    expect((await verify(database)).ok).toBe(false)
  })

  test("concurrent writers chain densely, and verification passes", async () => {
    const database = await seeded()
    await runAs(
      database,
      system,
    )(
      Effect.forEach(
        Array.from({ length: 40 }, (_, n) => n),
        (n) => writeTrail({ action: `test.burst.${n}` }),
        { concurrency: 10 },
      ),
    )
    const verdict = await verify(database)
    expect(verdict.pending).toBe(40)
    expect(verdict.ok).toBe(true)
    expect(await runAs(database, system)(chainTrail)).toBe(40)
    const after = await verify(database)
    expect(after).toMatchObject({ ok: true, pending: 0, checked: 47 })
    const [gaps] = await database.superuser`
      select count(*)::int as n from trail_events
      where chain_pos is not null
        and chain_pos <> (select count(*) from trail_events e where e.chain_pos <= trail_events.chain_pos)`
    expect(gaps.n).toBe(0)
  })

  test("no trigger on the trail notifies: a NOTIFY would serialise every commit", async () => {
    const database = await seeded()
    const triggers = await database.superuser<{ name: string; body: string }[]>`
      select t.tgname as name, p.prosrc as body
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'trail_events'::regclass and not t.tgisinternal`
    expect(triggers.length).toBeGreaterThan(0)
    expect(triggers.filter((trigger) => /notify/i.test(trigger.body)).map((t) => t.name)).toEqual(
      [],
    )
  })

  test("entries left unchained past the grace period fail verification", async () => {
    const database = await makeTestDatabase()
    created.push(database)
    await setupWorkspace(database)
    await runAs(database, system)(writeTrail({ action: "test.pending" }))
    const fresh = await verify(database)
    // setupWorkspace leaves two entries unchained, next to the one written here.
    expect(fresh).toMatchObject({ ok: true, pending: 3, overdue: 0 })
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`update trail_events set at = now() - interval '5 minutes' where chain_pos is null`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    expect(await verify(database)).toMatchObject({ ok: false, overdue: 3 })
  })

  test("a secret that cannot open the trail key is reported by name", async () => {
    const database = await seeded()
    const wrongSecrets = makeSecrets(
      Redacted.make("a-different-secret-0123456789abcdef-0123456789"),
    )
    const exit = await database.runtime.runPromise(
      loadTrailKey.pipe(Effect.provideService(Secrets, wrongSecrets), Effect.exit),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
      "AUDIT_SECRET_KEY does not open the trail key",
    )
  })
})
