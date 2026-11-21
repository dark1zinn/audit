import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Authz } from "@audit/core/authz"
import { openDm } from "@audit/core/chat/commands"
import { createDoc, deleteDoc } from "@audit/core/docs/commands"
import { getDoc, spaceTree } from "@audit/core/docs/queries"
import { visibleTo } from "@audit/core/access"
import { deactivateMember } from "@audit/core/identity/commands"
import { grantProjectAccess, createProject } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { BoardId, DocId, EntityId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import {
  addPerson,
  exitAs,
  type Person,
  runAs,
  setupWorkspace,
  system,
} from "@audit/testkit/fixtures"
import { Cause, Effect, Exit, Option } from "effect"
import { sql } from "drizzle-orm"

let database: TestDatabase
let owner: Person
let admin: Person
let retiredAdmin: Person
let member: Person
let other: Person
let projectId: ProjectId
let boardId: BoardId

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

const spaceId = WORKSPACE_SPACE_ID as EntityId

/** Whether `user` passes `visibleTo` for `id`, evaluated in SQL exactly as list queries do. */
const canSee = (user: Person, id: string) =>
  runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const rows = yield* db.execute<{ v: boolean }>(
        sql`select ${visibleTo(user.userId, sql`${id}`)} as v`,
      )
      return rows.rows[0]?.v === true
    }),
  )

const restrict = (docId: DocId) =>
  database.superuser`update entities set restricted = true where id = ${docId}`

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  admin = await addPerson(database, owner, "Ada", "admin")
  retiredAdmin = await addPerson(database, owner, "Rex", "admin")
  member = await addPerson(database, owner, "Mia", "member")
  other = await addPerson(database, owner, "Oto", "member")

  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "ADMGR", name: "Admin managed", visibility: "restricted" }))
  projectId = project.id as ProjectId
  await runAs(
    database,
    owner.actor,
  )(
    grantProjectAccess.execute({
      projectId,
      principalType: "user",
      principalId: member.userId,
      role: "editor",
    }),
  )
  boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId))) as BoardId
})

afterAll(() => database.drop())

describe("owners and admins manage all project content and docs", () => {
  test("(a) an admin deletes a member-created doc in a restricted project", async () => {
    const doc = await runAs(
      database,
      member.actor,
    )(createDoc.execute({ parentId: projectId, title: "Mia's project doc" }))
    await restrict(doc.id as DocId)

    await runAs(database, admin.actor)(deleteDoc.execute({ docId: doc.id as DocId }))
    const [row] = await database.superuser<Array<{ deleted: boolean }>>`
      select deleted_at is not null as deleted from entities where id = ${doc.id}`
    expect(row?.deleted).toBe(true)
  })

  test("(b) an admin reads and lists a restricted workspace-space doc", async () => {
    const doc = await runAs(
      database,
      member.actor,
    )(createDoc.execute({ parentId: spaceId, title: "Restricted space doc" }))
    await restrict(doc.id as DocId)

    const tree = await runAs(database, admin.actor)(spaceTree())
    expect(tree.some((node) => node.id === doc.id)).toBe(true)
    const read = await runAs(database, admin.actor)(getDoc(doc.id as DocId))
    expect(read.id).toBe(doc.id)
  })

  test("(c) a plain member is forbidden from deleting another person's project doc", async () => {
    const doc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: projectId, title: "Owner's project doc" }))

    const exit = await exitAs(database, member.actor)(deleteDoc.execute({ docId: doc.id as DocId }))
    expect(failureTag(exit)).toBe("Forbidden")
  })

  test("(d) a deactivated admin gets NotFound", async () => {
    const doc = await runAs(
      database,
      member.actor,
    )(createDoc.execute({ parentId: projectId, title: "Still here" }))

    await runAs(database, owner.actor)(deactivateMember.execute(retiredAdmin.userId as UserId))
    const exit = await exitAs(
      database,
      retiredAdmin.actor,
    )(deleteDoc.execute({ docId: doc.id as DocId }))
    expect(failureTag(exit)).toBe("NotFound")
  })

  test("(e) an admin cannot see a DM between two other members", async () => {
    const dm = await runAs(database, member.actor)(openDm.execute({ userIds: [other.userId] }))
    expect(await canSee(admin, dm.id)).toBe(false)
  })

  test("(f) an admin is manager on a task in a restricted project", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Admin manages this" }))
    const role = await runAs(
      database,
      admin.actor,
    )(
      Effect.gen(function* () {
        const authz = yield* Authz
        return yield* authz.roleOn(admin.userId, task.id as EntityId)
      }),
    )
    expect(role).toBe("manager")
  })
})
