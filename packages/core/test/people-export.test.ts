import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as people from "@audit/core/people/commands"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person
let member: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Fay", "member")
})

afterAll(async () => {
  await database.drop()
})

const trailCountFor = async (userId: string) => {
  const [row] = await database.superuser`
    select count(*)::int as n from trail_events
    where actor_type = 'user' and actor_id = ${userId}`
  return row?.n ?? 0
}

describe("people.exportMine", () => {
  test("exports the caller's own profile and only their own trail entries", async () => {
    const before = await trailCountFor(member.userId)
    const bundle = await runAs(database, member.actor)(people.exportMine.execute(undefined))

    expect(bundle.profile.userId).toBe(member.userId)
    expect(bundle.profile.email).toBe(member.email)
    expect(bundle.profile.role).toBe("member")
    expect(bundle.trail.length).toBe(before)
  })

  test("the export is recorded in the trail", async () => {
    await runAs(database, member.actor)(people.exportMine.execute(undefined))
    const [row] = await database.superuser`
      select count(*)::int as n from trail_events
      where action = 'me.exported' and actor_id = ${member.userId}`
    expect(row?.n).toBeGreaterThanOrEqual(1)
  })
})
