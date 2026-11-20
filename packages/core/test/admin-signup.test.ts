import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  approveSignup,
  pendingSignups,
  rejectSignup,
  signup,
  verifySignup,
} from "@audit/core/admin/signup"
import { updateSecurity } from "@audit/core/admin/commands"
import { Mailer } from "@audit/core/notifications/mail"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import {
  addPerson,
  exitAs,
  PASSWORD,
  type Person,
  runAs,
  setupWorkspace,
  system,
} from "@audit/testkit/fixtures"
import { Effect, Exit } from "effect"

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
    expect(created.delivery).toBe("email")

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
    expect(accepted.delivery).toBe("email")
    database.breachedPasswords.delete(PASSWORD)
  })
})

describe("sign-up verification and approval", () => {
  const openSignup = () =>
    runAs(
      database,
      owner.actor,
    )(
      updateSecurity.execute({
        signupPolicy: { mode: "domains", domains: ["example.test"] },
        breachedPasswordCheck: false,
      }),
    )

  const accountCount = async (email: string) => {
    const [row] =
      await database.superuser`select count(*)::int as n from "user" where email = ${email}`
    return row?.n ?? 0
  }

  const pendingCount = async (email: string) => {
    const [row] =
      await database.superuser`select count(*)::int as n from signup_requests where email = ${email}`
    return row?.n ?? 0
  }

  /** The single-use token carried by the verification link in the newest mail. */
  const tokenFromMail = (sent: { readonly text: string }) => {
    const link = sent.text.match(/\S+\?verify=\S+/)?.[0] ?? ""
    return new URL(link).searchParams.get("verify") ?? ""
  }

  test("with mail, no account exists until the emailed link is opened", async () => {
    await openSignup()
    const before = database.mail.length
    const result = await runAs(database, system)(signup.execute(newcomer("link@example.test")))
    expect(result.delivery).toBe("email")
    expect(await accountCount("link@example.test")).toBe(0)
    expect(await pendingCount("link@example.test")).toBe(1)

    const sent = database.mail.slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe("link@example.test")
    const token = tokenFromMail(sent[0]!)

    await runAs(database, system)(verifySignup.execute({ token }))
    expect(await accountCount("link@example.test")).toBe(1)
    expect(await pendingCount("link@example.test")).toBe(0)

    // The link is single-use: opening it again opens nothing.
    const again = await exitAs(database, system)(verifySignup.execute({ token }))
    expect(Exit.isFailure(again)).toBe(true)
  })

  test("a wrong or expired link opens no account", async () => {
    await openSignup()
    const before = database.mail.length
    await runAs(database, system)(signup.execute(newcomer("expired@example.test")))
    const token = tokenFromMail(database.mail[before]!)

    const wrong = await exitAs(database, system)(verifySignup.execute({ token: "not-the-token" }))
    expect(Exit.isFailure(wrong)).toBe(true)

    await database.superuser`update signup_requests
      set expires_at = now() - interval '1 minute' where email = 'expired@example.test'`
    const expired = await exitAs(database, system)(verifySignup.execute({ token }))
    expect(Exit.isFailure(expired)).toBe(true)
    expect(await accountCount("expired@example.test")).toBe(0)
  })

  test("an existing address and a live request both answer alike and send nothing", async () => {
    await openSignup()
    const before = database.mail.length
    const known = await runAs(database, system)(signup.execute(newcomer("owner@example.test")))
    expect(known.delivery).toBe("email")
    expect(await pendingCount("owner@example.test")).toBe(0)

    await runAs(database, system)(signup.execute(newcomer("twice@example.test")))
    const repeat = await runAs(database, system)(signup.execute(newcomer("twice@example.test")))
    expect(repeat.delivery).toBe("email")
    expect(await pendingCount("twice@example.test")).toBe(1)
    expect(database.mail.length - before).toBe(1)
  })

  test("without mail, an admin approves the request and only then the account exists", async () => {
    await openSignup()
    const result = await runAs(
      database,
      system,
    )(signup.execute(newcomer("approve@example.test")).pipe(Effect.provide(Mailer.disabled)))
    expect(result.delivery).toBe("approval")
    expect(await accountCount("approve@example.test")).toBe(0)

    const [request] = await runAs(database, owner.actor)(pendingSignups)
    expect(request?.email).toBe("approve@example.test")
    await runAs(database, owner.actor)(approveSignup.execute({ id: request!.id }))
    expect(await accountCount("approve@example.test")).toBe(1)
    expect(await pendingCount("approve@example.test")).toBe(0)
  })

  test("only admins decide sign-ups, and a rejected request opens nothing", async () => {
    await openSignup()
    const member = await addPerson(database, owner, "Mia", "member")
    await runAs(
      database,
      system,
    )(signup.execute(newcomer("reject@example.test")).pipe(Effect.provide(Mailer.disabled)))
    const [request] = await runAs(database, owner.actor)(pendingSignups)
    expect(request?.email).toBe("reject@example.test")

    const denied = await exitAs(database, member.actor)(approveSignup.execute({ id: request!.id }))
    expect(Exit.isFailure(denied)).toBe(true)
    expect(await pendingCount("reject@example.test")).toBe(1)

    await runAs(database, owner.actor)(rejectSignup.execute({ id: request!.id }))
    expect(await pendingCount("reject@example.test")).toBe(0)
    expect(await accountCount("reject@example.test")).toBe(0)
  })
})
