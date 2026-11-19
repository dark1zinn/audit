import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as identity from "@audit/core/identity/commands"
import { verifyTrail } from "@audit/core/trail-queries"
import { defaultWorkspaceSettings } from "@audit/domain/identity/schema"
import type { TeamId } from "@audit/domain/ids"
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
import { Cause, Effect, Exit, Option } from "effect"
import { SqlClient } from "effect/sql"

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

const trailCount = async (action?: string) => {
  const [row] =
    action === undefined
      ? await database.superuser`select count(*)::int as n from trail_events`
      : await database.superuser`select count(*)::int as n from trail_events where action = ${action}`
  return row.n as number
}

const inviteToken = async (
  by: Person,
  input: Parameters<typeof identity.createInvite.execute>[0],
) => {
  const created = await runAs(database, by.actor)(identity.createInvite.execute(input))
  return created.url.split("/join/")[1]!
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  admin = await addPerson(database, owner, "Admin", "admin")
  member = await addPerson(database, owner, "Member", "member")
}, 30_000)

afterAll(() => database.drop())

describe("every command writes an audit entry", () => {
  test("in the same transaction as its change", async () => {
    const commands: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["invite.create", () => inviteToken(admin, { role: "member" })],
      [
        "team.created",
        () =>
          runAs(database, admin.actor)(identity.createTeam.execute({ name: "Ops", slug: "ops" })),
      ],
      [
        "profile.updated",
        () => runAs(database, member.actor)(identity.updateProfile.execute({ title: "Engineer" })),
      ],
      [
        "workspace.updated",
        () => runAs(database, owner.actor)(identity.updateWorkspace.execute({ name: "Renamed" })),
      ],
      [
        "member.sessions_revoked",
        () => runAs(database, admin.actor)(identity.revokeSessions.execute(member.userId)),
      ],
    ]
    for (const [name, run] of commands) {
      const before = await trailCount()
      await run()
      expect({ name, added: (await trailCount()) - before > 0 }).toEqual({ name, added: true })
    }
  })

  test("a failed command leaves neither its change nor an entry", async () => {
    const before = await trailCount()
    await runAs(database, admin.actor)(identity.createTeam.execute({ name: "Dup", slug: "dup" }))
    const exit = await exitAs(
      database,
      admin.actor,
    )(identity.createTeam.execute({ name: "Dup again", slug: "dup" }))
    expect(failureTag(exit)).toBe("Conflict")
    expect(await trailCount()).toBe(before + 1)
    const [row] =
      await database.superuser`select count(*)::int as n from entities where title = 'Dup again'`
    expect(row.n).toBe(0)
  })
})

describe("audit trail", () => {
  test("the app role cannot update or delete entries", async () => {
    const attempt = (statement: string) =>
      database.runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.unsafe(statement)
        }).pipe(Effect.exit),
      )
    expect(Exit.isFailure(await attempt("update trail_events set action = 'forged'"))).toBe(true)
    expect(Exit.isFailure(await attempt("delete from trail_events"))).toBe(true)
  })

  test("verification detects a tampered entry", async () => {
    const intact = await runAs(database, system)(verifyTrail)
    expect(intact.ok).toBe(true)
    const [target] =
      await database.superuser`select seq from trail_events order by seq limit 1 offset 2`
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`update trail_events set action = 'forged' where seq = ${target.seq}`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    const broken = await runAs(database, system)(verifyTrail)
    expect(broken).toMatchObject({ ok: false, firstBrokenSeq: Number(target.seq) })
  })
})

describe("idempotency keys", () => {
  test("a retried command returns the stored result without running again", async () => {
    const run = () =>
      runAs(
        database,
        admin.actor,
      )(identity.createTeam.execute({ name: "Retry", slug: "retry" }, { idempotencyKey: "k-1" }))
    const first: TeamId = await run()
    const second: TeamId = await run()
    expect(second).toBe(first)
    const [row] =
      await database.superuser`select count(*)::int as n from teams where slug = 'retry'`
    expect(row.n).toBe(1)
  })
})

describe("invites", () => {
  const accept = (token: string, email: string) =>
    exitAs(
      database,
      system,
    )(identity.acceptInvite.execute({ token, name: "Joiner", email, password: PASSWORD }))

  test("a single-use invite works once", async () => {
    const token = await inviteToken(admin, { role: "member" })
    expect(failureTag(await accept(token, "once@example.test"))).toBe("success")
    expect(failureTag(await accept(token, "twice@example.test"))).toBe("NotFound")
  })

  test("an invite bound to an email rejects other addresses", async () => {
    const token = await inviteToken(admin, { role: "guest", email: "bound@example.test" })
    expect(failureTag(await accept(token, "other@example.test"))).toBe("ValidationError")
    expect(failureTag(await accept(token, "Bound@Example.test"))).toBe("success")
  })

  test("revoked and expired invites cannot be used", async () => {
    const revoked = await inviteToken(admin, { role: "member" })
    const [row] = await database.superuser`select id from invites order by created_at desc limit 1`
    await runAs(database, admin.actor)(identity.revokeInvite.execute(row.id))
    expect(failureTag(await accept(revoked, "revoked@example.test"))).toBe("NotFound")

    const expired = await inviteToken(admin, { role: "member" })
    await database.superuser`update invites set expires_at = now() - interval '1 minute'
      where id = (select id from invites order by created_at desc limit 1)`
    expect(failureTag(await accept(expired, "expired@example.test"))).toBe("NotFound")
  })

  test("members cannot invite unless the workspace allows it", async () => {
    const denied = await exitAs(
      database,
      member.actor,
    )(identity.createInvite.execute({ role: "member" }))
    expect(failureTag(denied)).toBe("Forbidden")
    await runAs(
      database,
      owner.actor,
    )(
      identity.updateWorkspace.execute({
        settings: { ...defaultWorkspaceSettings, membersCanInvite: true },
      }),
    )
    const allowed = await exitAs(
      database,
      member.actor,
    )(identity.createInvite.execute({ role: "guest" }))
    expect(failureTag(allowed)).toBe("success")
    const grantsStillDenied = await exitAs(
      database,
      member.actor,
    )(identity.createInvite.execute({ role: "member", teamIds: [] as never, projectGrants: [] }))
    expect(failureTag(grantsStillDenied)).toBe("success")
  })

  test("accepting joins the invite's teams", async () => {
    const teamId = await runAs(
      database,
      admin.actor,
    )(identity.createTeam.execute({ name: "Joined", slug: "joined" }))
    const token = await inviteToken(admin, { role: "member", teamIds: [teamId] })
    expect(failureTag(await accept(token, "teamed@example.test"))).toBe("success")
    const [row] = await database.superuser`select count(*)::int as n from team_members tm
      join "user" u on u.id = tm.user_id where u.email = 'teamed@example.test' and tm.team_id = ${teamId}`
    expect(row.n).toBe(1)
  })
})

describe("member administration", () => {
  test("nobody deactivates themselves or the owner", async () => {
    expect(
      failureTag(
        await exitAs(database, admin.actor)(identity.deactivateMember.execute(admin.userId)),
      ),
    ).toBe("Forbidden")
    expect(
      failureTag(
        await exitAs(database, admin.actor)(identity.deactivateMember.execute(owner.userId)),
      ),
    ).toBe("Forbidden")
  })

  test("members cannot manage other members", async () => {
    expect(
      failureTag(
        await exitAs(
          database,
          member.actor,
        )(identity.changeRole.execute({ userId: admin.userId, role: "member" })),
      ),
    ).toBe("Forbidden")
  })
})
