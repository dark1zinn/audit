import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { signup } from "@audit/core/admin/signup"
import { updateSecurity } from "@audit/core/admin/commands"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import {
  exitAs,
  PASSWORD,
  type Person,
  runAs,
  setupWorkspace,
  system,
} from "@audit/testkit/fixtures"
import { Exit } from "effect"

let database: TestDatabase
let owner: Person

const newcomer = (email: string) => ({
  name: "New Person",
  email,
  password: PASSWORD,
})

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

describe("self sign-up", () => {
  test("is refused while the sign-up policy is closed", async () => {
    await runAs(
      database,
      owner.actor,
    )(
      updateSecurity.execute({
        signupPolicy: { mode: "closed", domains: [] },
        breachedPasswordCheck: false,
      }),
    )
    const exit = await exitAs(database, system)(signup.execute(newcomer("closed@example.test")))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("accepts an email on an allowed domain and refuses others", async () => {
    await runAs(
      database,
      owner.actor,
    )(
      updateSecurity.execute({
        signupPolicy: { mode: "domains", domains: ["example.test"] },
        breachedPasswordCheck: false,
      }),
    )
    const created = await runAs(database, system)(signup.execute(newcomer("ok@example.test")))
    expect(created.userId).toBeString()

    const refused = await exitAs(database, system)(signup.execute(newcomer("out@other.test")))
    expect(Exit.isFailure(refused)).toBe(true)
  })

  test("refuses a breached password only when the check is on", async () => {
    database.breachedPasswords.add(PASSWORD)
    await runAs(
      database,
      owner.actor,
    )(
      updateSecurity.execute({
        signupPolicy: { mode: "domains", domains: ["example.test"] },
        breachedPasswordCheck: true,
      }),
    )
    const refused = await exitAs(database, system)(signup.execute(newcomer("breach@example.test")))
    expect(Exit.isFailure(refused)).toBe(true)

    await runAs(
      database,
      owner.actor,
    )(
      updateSecurity.execute({
        signupPolicy: { mode: "domains", domains: ["example.test"] },
        breachedPasswordCheck: false,
      }),
    )
    const accepted = await runAs(database, system)(signup.execute(newcomer("breach2@example.test")))
    expect(accepted.userId).toBeString()
    database.breachedPasswords.delete(PASSWORD)
  })
})
