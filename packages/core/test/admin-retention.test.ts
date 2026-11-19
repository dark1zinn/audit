import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { purgeTrail } from "@audit/core/admin/retention"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { exitAs, type Person, runAs, setupWorkspace, system } from "@audit/testkit/fixtures"
import { Exit } from "effect"

let database: TestDatabase
let owner: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

describe("trail retention", () => {
  test("refuses anyone but the system", async () => {
    const exit = await exitAs(database, owner.actor)(purgeTrail.execute({}))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("runs as the system and keeps recent trail entries", async () => {
    const before = await database.superuser`select count(*)::int as n from trail_events`
    const result = await runAs(database, system)(purgeTrail.execute({}))
    expect(result.purged).toBe(0)
    const after = await database.superuser`select count(*)::int as n from trail_events`
    // The purge itself appends one trail.purged entry; nothing else may be removed.
    expect(after[0]?.n).toBe((before[0]?.n ?? 0) + 1)
  })
})
