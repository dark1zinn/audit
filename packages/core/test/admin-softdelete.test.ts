import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createChannel, postMessage } from "@audit/core/chat/commands"
import { updateRetention } from "@audit/core/admin/commands"
import { purgeSoftDeleted } from "@audit/core/admin/retention"
import { softDeleteEntity } from "@audit/core/entities"
import { uploadFile } from "@audit/core/files/commands"
import { createDoc } from "@audit/core/docs/commands"
import { createProject, deleteProject, restoreProject } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import type { BoardId, EntityId, ProjectId } from "@audit/domain/ids"
import { BlobStore } from "@audit/platform/blob-store"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { type Person, runAs, setupWorkspace, system } from "@audit/testkit/fixtures"
import { Effect } from "effect"

let database: TestDatabase
let owner: Person
let projectId: EntityId
let boardId: BoardId

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%retention body\n")
const body = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

const upload = (name: string) =>
  runAs(database, owner.actor)(uploadFile.execute({ parentId: projectId, name, bytes: PDF_BYTES }))

const blobAt = (key: string) =>
  database.runtime.runPromise(
    Effect.gen(function* () {
      const blobs = yield* BlobStore
      return yield* blobs.get(key)
    }),
  )

/** Soft-deletes `id` now, then moves its deletion time `days` into the past. */
const retire = async (id: string, days: number) => {
  await runAs(database, system)(softDeleteEntity(id as EntityId))
  await database.superuser`
    update entities set deleted_at = now() - ${`${days} days`}::interval where id = ${id}`
}

const rowCount = async (table: "tasks" | "docs" | "messages" | "entities", id: string) => {
  const rows = await database.superuser.unsafe(`select id from ${table} where id = $1`, [id])
  return rows.length
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "SOFTD", name: "Soft delete", visibility: "workspace" }))
  projectId = project.id as EntityId
  boardId = (await runAs(database, owner.actor)(defaultBoardId(project.id as ProjectId))) as BoardId
  await runAs(
    database,
    owner.actor,
  )(updateRetention.execute({ trailRetentionDays: 30, softDeleteRetentionDays: 1 }))
}, 60_000)

afterAll(() => database.drop())

describe("soft-delete retention", () => {
  test("a file soft-deleted past the window loses its row and blob; a recent one keeps both", async () => {
    const old = await upload("old.pdf")
    const recent = await upload("recent.pdf")
    await retire(old.id, 3)
    await retire(recent.id, 0)
    await database.superuser`
      update entities set deleted_at = now() - interval '1 hour' where id = ${recent.id}`

    const result = await runAs(database, system)(purgeSoftDeleted)
    expect(result.purged).toBe(1)

    expect(await rowCount("entities", old.id)).toBe(0)
    expect(await blobAt(`originals/${old.id}`)).toBeNull()

    expect(await rowCount("entities", recent.id)).toBe(1)
    expect(await blobAt(`originals/${recent.id}`)).not.toBeNull()
  })

  test("expired task, doc and message go with their children and type rows", async () => {
    const task = await runAs(database, owner.actor)(createTask.execute({ boardId, title: "Gone" }))
    const subtask = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Gone sub", parentId: task.id }))
    const doc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: projectId, title: "Gone doc" }))
    const child = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: doc.id as EntityId, title: "Gone child" }))
    const channel = await runAs(
      database,
      owner.actor,
    )(createChannel.execute({ name: "gone-room", kind: "public" }))
    const message = await runAs(
      database,
      owner.actor,
    )(postMessage.execute({ channelId: channel.id, body: body("root") }))
    const reply = await runAs(
      database,
      owner.actor,
    )(postMessage.execute({ channelId: channel.id, body: body("reply"), threadRootId: message.id }))

    const ids = [task.id, subtask.id, doc.id, child.id, message.id, reply.id]
    for (const id of ids) await retire(id, 3)

    const result = await runAs(database, system)(purgeSoftDeleted)
    expect(result.purged).toBeGreaterThanOrEqual(ids.length)

    for (const id of ids) expect(await rowCount("entities", id)).toBe(0)
    expect(await rowCount("tasks", task.id)).toBe(0)
    expect(await rowCount("tasks", subtask.id)).toBe(0)
    expect(await rowCount("docs", doc.id)).toBe(0)
    expect(await rowCount("docs", child.id)).toBe(0)
    expect(await rowCount("messages", message.id)).toBe(0)
    expect(await rowCount("messages", reply.id)).toBe(0)

    const trail = await database.superuser`
      select count(*)::int as n from trail_events where action = 'entities.purged'`
    expect(trail[0]?.n).toBeGreaterThan(0)
  }, 60_000)

  test("a recent sibling survives; an expired message with a live reply survives", async () => {
    const younger = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Younger" }))
    await retire(younger.id, 0)
    await database.superuser`
      update entities set deleted_at = now() - interval '1 hour' where id = ${younger.id}`

    const channel = await runAs(
      database,
      owner.actor,
    )(createChannel.execute({ name: "kept-room", kind: "public" }))
    const root = await runAs(
      database,
      owner.actor,
    )(postMessage.execute({ channelId: channel.id, body: body("kept root") }))
    await runAs(
      database,
      owner.actor,
    )(
      postMessage.execute({
        channelId: channel.id,
        body: body("live reply"),
        threadRootId: root.id,
      }),
    )
    await retire(root.id, 3)

    await runAs(database, system)(purgeSoftDeleted)

    expect(await rowCount("tasks", younger.id)).toBe(1)
    expect(await rowCount("entities", younger.id)).toBe(1)
    expect(await rowCount("messages", root.id)).toBe(1)
  }, 60_000)

  test("a project restored before the window keeps its rows", async () => {
    const key = "SDRS"
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key, name: "Restore me", visibility: "workspace" }))
    const restoredBoard = (await runAs(
      database,
      owner.actor,
    )(defaultBoardId(project.id as ProjectId))) as BoardId
    const task = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: restoredBoard, title: "Restorable" }))

    await runAs(
      database,
      owner.actor,
    )(deleteProject.execute({ projectId: project.id as ProjectId, confirm: key }))
    // One statement gives every row the same deletion time, truncated to milliseconds like the
    // JS Date that project delete stamps; restore matches on that exact value.
    await database.superuser`
      update entities set deleted_at = date_trunc('milliseconds', now() - interval '3 days')
      where project_id = ${project.id} or id = ${project.id}`
    await runAs(
      database,
      owner.actor,
    )(restoreProject.execute({ projectId: project.id as ProjectId }))

    await runAs(database, system)(purgeSoftDeleted)

    expect(await rowCount("tasks", task.id)).toBe(1)
    const [row] = await database.superuser`select deleted_at from entities where id = ${task.id}`
    expect(row?.deleted_at).toBeNull()
  }, 60_000)
})
