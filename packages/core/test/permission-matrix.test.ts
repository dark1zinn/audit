/**
 * Generated permission matrix: workspace roles and grant paths × project visibility × restricted
 * container × restricted item × node depth × action. The expected outcome comes from an oracle that
 * implements the plan's rules directly, independent of the SQL in `access.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Authz } from "@audit/core/authz"
import type { EntityId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { type ResourceAction, minimumRole } from "@audit/domain/permissions"
import { type ResourceRole, maxRole, roleAtLeast } from "@audit/domain/roles"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import {
  addPerson,
  exitAs,
  type Person,
  setupWorkspace,
  system,
  runAs,
} from "@audit/testkit/fixtures"
import { sql } from "drizzle-orm"
import { Cause, Effect, Exit, Option } from "effect"

type Principal =
  | "owner"
  | "admin"
  | "member"
  | "guest"
  | "guestGranted"
  | "teamMember"
  | "boardManager"
type Node = "project" | "board" | "task" | "subtask"

interface Case {
  readonly visibility: "workspace" | "restricted"
  readonly boardRestricted: boolean
  readonly taskRestricted: boolean
}

const cases: ReadonlyArray<Case> = (["workspace", "restricted"] as const).flatMap((visibility) =>
  [false, true].flatMap((boardRestricted) =>
    [false, true].map((taskRestricted) => ({ visibility, boardRestricted, taskRestricted })),
  ),
)

/** Grants each fixture places, by node and principal. */
const ownGrants = (c: Case, node: Node, principal: Principal): ResourceRole | null => {
  switch (node) {
    case "project": {
      let role: ResourceRole | null = null
      // Workspace visibility: implicit editor for every non-guest member.
      if (c.visibility === "workspace" && principal !== "guest" && principal !== "guestGranted") {
        role = maxRole(role, "editor")
      }
      if (principal === "teamMember") role = maxRole(role, "editor")
      if (principal === "guestGranted") role = maxRole(role, "viewer")
      return role
    }
    case "board":
      return principal === "boardManager" ? "manager" : null
    case "task":
      return c.taskRestricted && principal === "member" ? "commenter" : null
    case "subtask":
      return null
  }
}

/** The plan's rule: highest grant on the node or its ancestors, up to a restricted boundary. */
const expectedRole = (c: Case, node: Node, principal: Principal): ResourceRole | null => {
  // owners/admins manage all project content
  if (principal === "owner" || principal === "admin") return "manager"
  const own = ownGrants(c, node, principal)
  switch (node) {
    case "project":
      return own
    case "board":
      return c.boardRestricted ? own : maxRole(own, expectedRole(c, "project", principal))
    case "task":
      return c.taskRestricted ? own : maxRole(own, expectedRole(c, "board", principal))
    case "subtask":
      return maxRole(own, expectedRole(c, "task", principal))
  }
}

const actions: ReadonlyArray<ResourceAction> = [
  "task.read",
  "task.comment",
  "task.update",
  "task.delete",
]

let database: TestDatabase
const people = {} as Record<Principal, Person>
const nodes: Array<{ readonly c: Case; readonly ids: Record<Node, EntityId> }> = []

beforeAll(async () => {
  database = await makeTestDatabase()
  const owner = await setupWorkspace(database)
  people.owner = owner
  people.admin = await addPerson(database, owner, "Admin", "admin")
  people.member = await addPerson(database, owner, "Member", "member")
  people.guest = await addPerson(database, owner, "Guest", "guest")
  people.guestGranted = await addPerson(database, owner, "Granted Guest", "guest")
  people.teamMember = await addPerson(database, owner, "Team Member", "member")
  people.boardManager = await addPerson(database, owner, "Board Manager", "member")

  const db = database.superuser
  for (const c of cases) {
    const [project] =
      await db`insert into entities (type, title) values ('project', 'P') returning id`
    const [team] = await db`insert into entities (type, title) values ('team', 'T') returning id`
    const [board] = await db`insert into entities (type, title, parent_id, project_id, restricted)
      values ('board', 'B', ${project.id}, ${project.id}, ${c.boardRestricted}) returning id`
    const [task] = await db`insert into entities (type, title, parent_id, project_id, restricted)
      values ('task', 'T', ${board.id}, ${project.id}, ${c.taskRestricted}) returning id`
    const [subtask] = await db`insert into entities (type, title, parent_id, project_id)
      values ('task', 'S', ${task.id}, ${project.id}) returning id`
    const key = `P${nodes.length}`.replace(/\d/g, (d) => "ABCDEFGHIJ"[Number(d)]!)
    await db`insert into projects (id, key, name, visibility) values (${project.id}, ${`X${key}`}, 'P', ${c.visibility})`
    await db`insert into teams (id, name, slug, kind, project_id) values (${team.id}, 'T', ${`t-${nodes.length}`}, 'project', ${project.id})`
    await db`insert into team_members (team_id, user_id) values (${team.id}, ${people.teamMember.userId})`
    if (c.visibility === "workspace") {
      for (const role of ["owner", "admin", "member"]) {
        await db`insert into access_entries (resource_id, principal_type, principal_role, role)
          values (${project.id}, 'role', ${role}, 'editor')`
      }
    }
    await db`insert into access_entries (resource_id, principal_type, principal_id, role)
      values (${project.id}, 'team', ${team.id}, 'editor')`
    await db`insert into access_entries (resource_id, principal_type, principal_id, role)
      values (${project.id}, 'user', ${people.guestGranted.userId}, 'viewer')`
    await db`insert into access_entries (resource_id, principal_type, principal_id, role)
      values (${board.id}, 'user', ${people.boardManager.userId}, 'manager')`
    if (c.taskRestricted) {
      await db`insert into access_entries (resource_id, principal_type, principal_id, role)
        values (${task.id}, 'user', ${people.member.userId}, 'commenter')`
    }
    nodes.push({
      c,
      ids: { project: project.id, board: board.id, task: task.id, subtask: subtask.id },
    })
  }
  await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.rebuild({})
    }),
  )
}, 60_000)

afterAll(() => database.drop())

const failureTag = (exit: Exit.Exit<unknown, { readonly _tag: string }>) =>
  Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause).pipe(
        Option.map((e) => e._tag),
        Option.getOrElse(() => "defect"),
      )
    : "ok"

const label = (c: Case) =>
  `${c.visibility} project, ${c.boardRestricted ? "restricted" : "open"} board, ${c.taskRestricted ? "restricted" : "open"} task`

describe("permission matrix", () => {
  for (const [index, c] of cases.entries()) {
    test(label(c), async () => {
      const ids = nodes[index]!.ids
      const failures: Array<string> = []
      for (const principal of Object.keys(people) as Array<Principal>) {
        const person = people[principal]
        for (const node of ["project", "board", "task", "subtask"] as const) {
          const expected = expectedRole(c, node, principal)
          for (const action of actions) {
            const exit = await exitAs(
              database,
              person.actor,
            )(
              Effect.gen(function* () {
                const authz = yield* Authz
                yield* authz.requireOn(action, ids[node])
              }),
            )
            const outcome = Exit.isSuccess(exit) ? "ok" : failureTag(exit)
            const want =
              expected === null
                ? "NotFound"
                : roleAtLeast(expected, minimumRole(action))
                  ? "ok"
                  : "Forbidden"
            if (outcome !== want)
              failures.push(`${principal} ${action} on ${node}: got ${outcome}, want ${want}`)
          }
        }
      }
      expect(failures).toEqual([])
    })
  }

  test("visibility filter agrees with the oracle", async () => {
    const failures: Array<string> = []
    for (const principal of Object.keys(people) as Array<Principal>) {
      const person = people[principal]
      const visibleIds = await runAs(
        database,
        person.actor,
      )(
        Effect.gen(function* () {
          const authz = yield* Authz
          const db = yield* Db
          const condition = yield* authz.visible(sql`e.id`)
          const result = yield* db.execute<{ id: string }>(
            sql`select e.id from entities e where e.type in ('project', 'board', 'task') and ${condition}`,
          )
          return new Set(result.rows.map((r) => r.id))
        }),
      )
      for (const { c, ids } of nodes) {
        for (const node of ["project", "board", "task", "subtask"] as const) {
          const want = expectedRole(c, node, principal) !== null
          if (visibleIds.has(ids[node]) !== want) {
            failures.push(`${principal} ${node} in ${label(c)}: visible=${!want}, want ${want}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })
})
