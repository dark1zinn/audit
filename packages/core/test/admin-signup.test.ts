import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { approveSignup, pendingSignups, rejectSignup, signup } from "@audit/core/admin/signup"
import { updateSecurity } from "@audit/core/admin/commands"
import { inviteMailJob } from "@audit/core/notifications/account-mail"
import { Mailer } from "@audit/core/notifications/mail"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import {
  addPerson,
  exitAs,
  type Person,
  runAs,
  setupWorkspace,
  system,
} from "@audit/testkit/fixtures"
import { Effect, Exit } from "effect"

let database: TestDatabase
let owner: Person

const newcomer = (email: string) => ({ name: "New Person", email })

const inviteJobsFor = (email: string) =>
  database.jobs.enqueued.filter(
    (job) =>
      job.name === inviteMailJob.name &&
      typeof job.data === "object" &&
      job.data !== null &&
      "email" in job.data &&
      job.data.email === email,
  )

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

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
    await openSignup()
    const created = await runAs(database, system)(signup.execute(newcomer("ok@example.test")))
    expect(created.delivery).toBe("email")

    const refused = await exitAs(database, system)(signup.execute(newcomer("out@other.test")))
    expect(Exit.isFailure(refused)).toBe(true)
  })
})

describe("sign-up invites and approval", () => {
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

  const liveInviteCount = async (email: string) => {
    const [row] = await database.superuser`select count(*)::int as n from invites
        where email = ${email} and revoked_at is null`
    return row?.n ?? 0
  }

  test("with mail, no account exists and a single-use invite is queued for that email", async () => {
    await openSignup()
    const result = await runAs(database, system)(signup.execute(newcomer("link@example.test")))
    expect(result.delivery).toBe("email")
    expect(await accountCount("link@example.test")).toBe(0)
    expect(await pendingCount("link@example.test")).toBe(0)
    expect(await liveInviteCount("link@example.test")).toBe(1)

    const jobs = inviteJobsFor("link@example.test")
    expect(jobs).toHaveLength(1)
    expect(JSON.stringify(jobs[0]?.data)).toMatch(/\/join\/\S+/)

    const [invite] = await database.superuser`select role, created_by, max_uses, use_count
      from invites where email = 'link@example.test'`
    expect(invite?.role).toBe("member")
    expect(invite?.created_by).toBeNull()
    expect(invite?.max_uses).toBe(1)
    expect(invite?.use_count).toBe(0)
  })

  test("a newer request replaces the older unused invite for the same email", async () => {
    await openSignup()
    await runAs(database, system)(signup.execute(newcomer("replace@example.test")))
    await runAs(database, system)(signup.execute(newcomer("replace@example.test")))
    expect(await liveInviteCount("replace@example.test")).toBe(1)
    expect(await accountCount("replace@example.test")).toBe(0)
  })

  test("an existing address answers like a new one and queues no mail", async () => {
    await openSignup()
    const known = await runAs(database, system)(signup.execute(newcomer(owner.email)))
    expect(known.delivery).toBe("email")
    expect(inviteJobsFor(owner.email)).toHaveLength(0)
    expect(await liveInviteCount(owner.email)).toBe(0)
  })

  test("without mail, the request waits and an admin approval creates the invite", async () => {
    await openSignup()
    const result = await runAs(
      database,
      system,
    )(signup.execute(newcomer("approve@example.test")).pipe(Effect.provide(Mailer.disabled)))
    expect(result.delivery).toBe("approval")
    expect(await pendingCount("approve@example.test")).toBe(1)
    expect(await liveInviteCount("approve@example.test")).toBe(0)

    const [request] = await runAs(database, owner.actor)(pendingSignups)
    expect(request?.email).toBe("approve@example.test")
    const approved = await runAs(database, owner.actor)(approveSignup.execute({ id: request!.id }))
    expect(approved.url).toMatch(/\/join\/\S+/)
    expect(await pendingCount("approve@example.test")).toBe(0)
    expect(await liveInviteCount("approve@example.test")).toBe(1)
    expect(await accountCount("approve@example.test")).toBe(0)
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
    expect(await liveInviteCount("reject@example.test")).toBe(0)
    expect(await accountCount("reject@example.test")).toBe(0)
  })
})
