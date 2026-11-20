import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as identity from "@audit/core/identity/commands"
import { RESET_IDENTIFIER_PREFIX } from "@audit/core/identity/reset-token"
import { sha256Hex } from "@audit/platform/crypto"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person
let member: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Member", "member")
}, 30_000)

afterAll(() => database.drop())

describe("password reset links", () => {
  test("the database keeps the token's hash, so a read cannot be replayed as a reset", async () => {
    const link = await runAs(
      database,
      owner.actor,
    )(identity.createPasswordResetLink.execute(member.userId))
    const token = new URL(link.url).searchParams.get("token") ?? ""
    expect(token.length).toBeGreaterThan(0)

    const rows = await database.superuser`
      select identifier from verification where value = ${member.userId}`
    expect(rows.map((row: { identifier: unknown }) => row.identifier)).toEqual([
      `${RESET_IDENTIFIER_PREFIX}${sha256Hex(token)}`,
    ])
    expect(
      rows.some((row: { identifier: unknown }) => String(row.identifier).includes(token)),
    ).toBe(false)
  })
})
