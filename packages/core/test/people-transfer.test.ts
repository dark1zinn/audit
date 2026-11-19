import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as people from "@audit/core/people/commands"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person
let admin: Person
let member: Person

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) =>
          typeof error === "object" && error !== null && "_tag" in error
            ? String(error._tag)
            : "unknown",
        ),
        Option.getOrElse(() => "defect"),
      )
    : "success"

const roleOf = async (userId: string) => {
  const [row] =
    await database.superuser`select role from workspace_members where user_id = ${userId}`
  return row?.role
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  admin = await addPerson(database, owner, "Ada", "admin")
  member = await addPerson(database, owner, "Bea", "member")
})

afterAll(async () => {
  await database.drop()
})

describe("people.transferOwnership", () => {
  test("only the owner can transfer ownership", async () => {
    const exit = await exitAs(
      database,
      admin.actor,
    )(people.transferOwnership.execute({ userId: member.userId }))
    expect(failureTag(exit)).toBe("Forbidden")
    expect(await roleOf(member.userId)).toBe("member")
  })

  test("transferring to yourself is rejected", async () => {
    const exit = await exitAs(
      database,
      owner.actor,
    )(people.transferOwnership.execute({ userId: owner.userId }))
    expect(failureTag(exit)).toBe("ValidationError")
  })

  test("the owner hands over to an admin and becomes an admin", async () => {
    await runAs(database, owner.actor)(people.transferOwnership.execute({ userId: admin.userId }))
    expect(await roleOf(admin.userId)).toBe("owner")
    expect(await roleOf(owner.userId)).toBe("admin")

    const [trail] = await database.superuser`
      select count(*)::int as n from trail_events
      where action = 'workspace.ownership_transferred' and entity_id = ${admin.userId}`
    expect(trail?.n).toBe(1)
  })
})
