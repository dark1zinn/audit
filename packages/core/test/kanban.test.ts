import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { archiveProject, createProject, unarchiveProject } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { loadBoard } from "@audit/core/projects/board-read"
import { createTask, moveTask, updateTask } from "@audit/core/tasks/commands"
import { backlinks } from "@audit/core/references"
import type { EntityId, ProjectId, TaskId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { type Person, exitAs, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person

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

/** Creates a project as the owner and returns its id and default board id. */
const newProject = async (key: string) => {
  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key, name: `Project ${key}` }))
  const boardId = await runAs(database, owner.actor)(defaultBoardId(project.id as ProjectId))
  if (boardId === null) throw new Error("project has no default board")
  return { projectId: project.id as ProjectId, boardId }
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
})

afterAll(() => database.drop())

describe("project creation", () => {
  test("creates a default board with backlog, todo, in progress and done columns", async () => {
    const { boardId } = await newProject("BOARD")
    const board = await runAs(database, owner.actor)(loadBoard(boardId))
    expect(board.columns.map((column) => column.category)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "done",
    ])
  })
})

describe("task keys", () => {
  test("50 concurrent creates produce 50 distinct keys", async () => {
    const { boardId } = await newProject("CONC")
    const cards = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        runAs(database, owner.actor)(createTask.execute({ boardId, title: `Task ${index}` })),
      ),
    )
    expect(new Set(cards.map((card) => card.key)).size).toBe(50)
  })
})

describe("archived projects are read-only", () => {
  test("task creation fails with Forbidden until the project is unarchived", async () => {
    const { projectId, boardId } = await newProject("ARCH")
    await runAs(database, owner.actor)(archiveProject.execute({ projectId }))

    const blocked = await exitAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Blocked" }))
    expect(failureTag(blocked)).toBe("Forbidden")

    await runAs(database, owner.actor)(unarchiveProject.execute({ projectId }))
    const allowed = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Allowed" }))
    expect(allowed.title).toBe("Allowed")
  })
})

describe("done column completion", () => {
  test("moving into done sets completedAt and moving out clears it", async () => {
    const { boardId } = await newProject("DONE")
    const board = await runAs(database, owner.actor)(loadBoard(boardId))
    const todo = board.columns.find((column) => column.category === "todo")
    const done = board.columns.find((column) => column.category === "done")
    if (!todo || !done) throw new Error("default columns missing")

    const card = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Finish me", columnId: todo.id }))
    const finished = await runAs(
      database,
      owner.actor,
    )(moveTask.execute({ taskId: card.id, columnId: done.id, afterTaskId: null }))
    expect(finished.completedAt).not.toBeNull()

    const reopened = await runAs(
      database,
      owner.actor,
    )(moveTask.execute({ taskId: card.id, columnId: todo.id, afterTaskId: null }))
    expect(reopened.completedAt).toBeNull()
  })
})

describe("optimistic versions", () => {
  test("an update with a stale version is a Conflict", async () => {
    const { boardId } = await newProject("VERS")
    const card = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Versioned" }))
    const stale = await exitAs(
      database,
      owner.actor,
    )(updateTask.execute({ taskId: card.id, title: "Edited", version: card.version + 5 }))
    expect(failureTag(stale)).toBe("Conflict")
  })
})

describe("task description mentions", () => {
  test("become backlinks of the mentioned entity and follow description edits", async () => {
    const { boardId } = await newProject("MENT")
    const target = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Target" }))
    const mentionOf = (id: string) => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Depends on " },
            { type: "mention", attrs: { id, type: "task", label: "Target" } },
          ],
        },
      ],
    })
    const source = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Source", description: mentionOf(target.id) }))
    const linked = await runAs(database, owner.actor)(backlinks(target.id as EntityId))
    expect(
      linked.flatMap((group) => group.items.map((item) => [item.sourceId, item.snippet])),
    ).toEqual([[source.id, "Depends on @Target"]])

    await runAs(
      database,
      owner.actor,
    )(
      updateTask.execute({
        taskId: source.id as TaskId,
        description: { type: "doc", content: [] },
      }),
    )
    expect(await runAs(database, owner.actor)(backlinks(target.id as EntityId))).toEqual([])
  })
})
