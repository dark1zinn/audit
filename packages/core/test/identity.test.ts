import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as identity from "@audit/core/identity/commands"
import { EventBus } from "@audit/core/event-bus"
import { chainTrail } from "@audit/core/trail-chain"
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
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
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
    await runAs(database, system)(chainTrail)
    const intact = await runAs(database, system)(verifyTrail())
    expect(intact.ok).toBe(true)
    const [target] =
      await database.superuser`select chain_pos from trail_events order by chain_pos limit 1 offset 2`
    await database.superuser`alter table trail_events disable trigger trail_events_append_only`
    await database.superuser`update trail_events set action = 'forged' where chain_pos = ${target.chain_pos}`
    await database.superuser`alter table trail_events enable trigger trail_events_append_only`
    const broken = await runAs(database, system)(verifyTrail())
    expect(broken).toMatchObject({ ok: false, firstBrokenPos: Number(target.chain_pos) })
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

describe("team leads on teams that hold grants", () => {
  test("cannot add guests or promote members to lead; admins still can", async () => {
    const teamId = await runAs(
      database,
      admin.actor,
    )(identity.createTeam.execute({ name: "Granted", slug: "granted" }))
    await runAs(
      database,
      admin.actor,
    )(identity.setTeamMember.execute({ teamId, userId: member.userId, role: "lead" }))
    await database.superuser`
      insert into access_entries (resource_id, principal_type, principal_id, role)
      values (${teamId}, 'team', ${teamId}, 'viewer')`
    const guest = await addPerson(database, owner, "Guest", "guest")
    const other = await addPerson(database, owner, "Other", "member")

    expect(
      failureTag(
        await exitAs(
          database,
          member.actor,
        )(identity.setTeamMember.execute({ teamId, userId: guest.userId, role: "member" })),
      ),
    ).toBe("Forbidden")
    expect(
      failureTag(
        await exitAs(
          database,
          member.actor,
        )(identity.setTeamMember.execute({ teamId, userId: other.userId, role: "lead" })),
      ),
    ).toBe("Forbidden")
    expect(
      failureTag(
        await exitAs(
          database,
          admin.actor,
        )(identity.setTeamMember.execute({ teamId, userId: guest.userId, role: "member" })),
      ),
    ).toBe("success")
  })
})

describe("deactivation", () => {
  test("a deactivated person loses their push subscriptions and calendar token", async () => {
    const leaver = await addPerson(database, owner, "Leo", "member")
    await database.superuser`
      update user_profiles set ical_token_hash = 'hash' where user_id = ${leaver.userId}`
    await database.superuser`
      insert into push_subscriptions (user_id, endpoint, p256dh, auth)
      values (${leaver.userId}, 'https://push.example.test/leo', 'p', 'a')`

    await runAs(database, owner.actor)(identity.deactivateMember.execute(leaver.userId))

    const [profile] = await database.superuser`
      select ical_token_hash from user_profiles where user_id = ${leaver.userId}`
    const [subs] = await database.superuser`
      select count(*)::int as n from push_subscriptions where user_id = ${leaver.userId}`
    expect(profile?.ical_token_hash).toBeNull()
    expect(subs?.n).toBe(0)
  })

  test("revoking sessions publishes MembersChanged so the person's live sockets close", async () => {
    const target = await addPerson(database, owner, "Rae", "member")
    const published = await runAs(
      database,
      owner.actor,
    )(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* EventBus
          const events = yield* bus.subscribe
          const first = yield* Effect.forkScoped(
            events.pipe(
              Stream.filter((event) => event._tag === "MembersChanged"),
              Stream.runHead,
            ),
          )
          yield* identity.revokeSessions.execute(target.userId)
          return yield* Fiber.join(first)
        }),
      ),
    )
    expect(Option.getOrUndefined(published)).toMatchObject({
      _tag: "MembersChanged",
      userId: target.userId,
    })
  })
})
