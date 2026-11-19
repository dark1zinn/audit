import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as people from "@audit/core/people/commands"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person
let admin: Person
let member: Person
let doomed: Person

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

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  admin = await addPerson(database, owner, "Cy", "admin")
  member = await addPerson(database, owner, "Di", "member")
  doomed = await addPerson(database, owner, "Ed", "member")
})

afterAll(async () => {
  await database.drop()
})

describe("people.deleteMember", () => {
  test("only the owner can delete members", async () => {
    const exit = await exitAs(database, admin.actor)(people.deleteMember.execute(member.userId))
    expect(failureTag(exit)).toBe("Forbidden")
  })

  test("nobody deletes their own account or the owner", async () => {
    const self = await exitAs(database, owner.actor)(people.deleteMember.execute(owner.userId))
    expect(failureTag(self)).toBe("Forbidden")
    const ownerTarget = await exitAs(
      database,
      admin.actor,
    )(people.deleteMember.execute(owner.userId))
    expect(failureTag(ownerTarget)).toBe("Forbidden")
  })

  test("deleting a member removes access and anonymises the account", async () => {
    await runAs(database, owner.actor)(people.deleteMember.execute(doomed.userId))

    const [membership] = await database.superuser`
      select count(*)::int as n from workspace_members where user_id = ${doomed.userId}`
    expect(membership?.n).toBe(0)

    const [account] = await database.superuser`
      select name, email, two_factor_enabled from "user" where id = ${doomed.userId}`
    expect(account?.name).toBe("Deleted member")
    expect(account?.email).toBe(`deleted+${doomed.userId}@invalid`)
    expect(account?.two_factor_enabled).toBe(false)

    const [profile] = await database.superuser`
      select display_name, deactivated_at, deleted_at from user_profiles where user_id = ${doomed.userId}`
    expect(profile?.display_name).toBe("Deleted member")
    expect(profile?.deactivated_at).not.toBeNull()
    expect(profile?.deleted_at).not.toBeNull()

    const [trail] = await database.superuser`
      select count(*)::int as n from trail_events
      where action = 'member.deleted' and entity_id = ${doomed.userId}`
    expect(trail?.n).toBe(1)
  })

  test("a deleted member is no longer a member and cannot be deleted again", async () => {
    const exit = await exitAs(database, owner.actor)(people.deleteMember.execute(doomed.userId))
    expect(failureTag(exit)).toBe("NotFound")
  })
})
