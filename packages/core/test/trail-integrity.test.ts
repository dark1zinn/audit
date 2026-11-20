import { writeTrail } from "@audit/core/trail"
import { verifyTrail } from "@audit/core/trail-queries"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { runAs, setupWorkspace, system } from "@audit/testkit/fixtures"
import { SqlClient } from "effect/sql"
import { Effect, Exit } from "effect"
import { describe, expect, test } from "bun:test"

/** A fresh database with a workspace and five trail entries; each test owns one. */
const seeded = async (): Promise<TestDatabase> => {
  const database = await makeTestDatabase()
  await setupWorkspace(database)
  await runAs(
    database,
    system,
  )(Effect.forEach([1, 2, 3, 4, 5], (n) => writeTrail({ action: `test.seed.${n}` })))
  return database
}

describe("trail integrity", () => {
  test("a forged row whose unkeyed chain was rebuilt is detected", async () => {
    const database = await seeded()
    const intact = await runAs(database, system)(verifyTrail())
    expect(intact.ok).toBe(true)
    const [target] =
      await database.superuser`select seq from trail_events order by seq limit 1 offset 2`
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`update trail_events set action = 'forged' where seq = ${target.seq}`
    // An attacker with DB write access rebuilds the unkeyed SHA-256 chain from the forged row onward.
    const tail =
      await database.superuser`select seq from trail_events where seq >= ${target.seq} order by seq`
    for (const row of tail) {
      await database.superuser`update trail_events set prev_hash = (select hash from trail_events where seq = ${row.seq} - 1) where seq = ${row.seq}`
      await database.superuser`update trail_events t set hash = trail_event_hash(t) where seq = ${row.seq}`
    }
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    const broken = await runAs(database, system)(verifyTrail())
    expect(broken.ok).toBe(false)
  })

  test("tail truncation is detected against an expected head", async () => {
    const database = await seeded()
    const [last] =
      await database.superuser`select seq, hash from trail_events order by seq desc limit 1`
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`delete from trail_events where seq = ${last.seq}`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    const withoutHead = await runAs(database, system)(verifyTrail())
    expect(withoutHead.ok).toBe(true)
    const withHead = await runAs(
      database,
      system,
    )(verifyTrail({ expectedHead: { seq: Number(last.seq), hash: last.hash } }))
    expect(withHead.ok).toBe(false)
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
    await database.superuser`update trail_events set at = now() - interval '40 days' where seq <= 2`
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
    const verdict = await runAs(database, system)(verifyTrail())
    expect(verdict.ok).toBe(true)
  })
})
