import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { loadBoard } from "@audit/core/projects/board-read"
import { createProject, grantProjectAccess } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import {
  bulkAssignTasks,
  bulkDeleteTasks,
  bulkMoveTasks,
  createTask,
  linkTask,
} from "@audit/core/tasks/commands"
import { taskDetail } from "@audit/core/tasks/queries"
import type { BoardId, ColumnId, ProjectId, TaskId, UserId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person
let editor: Person
let readable: { boardId: BoardId; projectId: ProjectId }
let hidden: { boardId: BoardId; projectId: ProjectId }

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

const newRestrictedProject = async (key: string) => {
  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key, name: `Project ${key}`, visibility: "restricted" }))
  const projectId = project.id as ProjectId
  const boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId)))!
  return { projectId, boardId }
}

const boardColumns = async (boardId: BoardId) => {
  const board = await runAs(database, owner.actor)(loadBoard(boardId))
  return board.columns.map((column) => column.id as ColumnId)
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  editor = await addPerson(database, owner, "Eli", "member")
  readable = await newRestrictedProject("BULKOK")
  hidden = await newRestrictedProject("BULKNO")
  await runAs(
    database,
    owner.actor,
  )(
    grantProjectAccess.execute({
      projectId: readable.projectId,
      principalType: "user",
      principalId: editor.userId,
      role: "editor",
    }),
  )
})

afterAll(() => database.drop())

describe("bulk commands with a task the actor cannot edit", () => {
  test("bulk move fails and moves none of the tasks", async () => {
    const own = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: readable.boardId, title: "Movable" }))
    const other = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: hidden.boardId, title: "Unreachable" }))
    const columns = await boardColumns(readable.boardId)
    const target = columns[columns.length - 1]!

    const exit = await exitAs(
      database,
      editor.actor,
    )(
      bulkMoveTasks.execute({
        taskIds: [own.id as TaskId, other.id as TaskId],
        columnId: target,
      }),
    )
    expect(failureTag(exit)).toBe("NotFound")

    const after = await runAs(database, owner.actor)(taskDetail(own.id as TaskId))
    expect(after.columnId).toBe(columns[0]!)
  })

  test("bulk assign fails and assigns none of the tasks", async () => {
    const own = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: readable.boardId, title: "Assignable" }))
    const other = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: hidden.boardId, title: "Hidden assign" }))

    const exit = await exitAs(
      database,
      editor.actor,
    )(
      bulkAssignTasks.execute({
        taskIds: [own.id as TaskId, other.id as TaskId],
        add: [editor.userId as UserId],
        remove: [],
      }),
    )
    expect(failureTag(exit)).toBe("NotFound")

    const after = await runAs(database, owner.actor)(taskDetail(own.id as TaskId))
    expect(after.assignees).not.toContain(editor.userId)
  })

  test("bulk delete fails and deletes none of the tasks", async () => {
    const own = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: readable.boardId, title: "Survivor" }))
    const other = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: hidden.boardId, title: "Guarded" }))

    const exit = await exitAs(
      database,
      editor.actor,
    )(bulkDeleteTasks.execute({ taskIds: [own.id as TaskId, other.id as TaskId] }))
    expect(failureTag(exit)).toBe("Forbidden")

    const still = await runAs(database, owner.actor)(taskDetail(own.id as TaskId))
    expect(still.id).toBe(own.id)
  })
})

describe("relations to tasks in restricted projects", () => {
  test("a user without access sees the relation as restricted, with no title or key", async () => {
    const source = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: readable.boardId, title: "Source" }))
    const secret = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: hidden.boardId, title: "Top secret title" }))

    await runAs(
      database,
      owner.actor,
    )(
      linkTask.execute({
        taskId: source.id as TaskId,
        targetId: secret.id as TaskId,
        kind: "relates",
      }),
    )

    const seen = await runAs(database, editor.actor)(taskDetail(source.id as TaskId))
    const relation = seen.relations.find((item) => item.targetId === secret.id)
    expect(relation).toBeDefined()
    expect(relation?.restricted).toBe(true)
    expect(relation?.title).toBeNull()
    expect(relation?.key).toBeNull()
    expect(JSON.stringify(seen)).not.toContain("Top secret title")
  })
})

describe("create response", () => {
  test("returns the human key built from the project key and sequence", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: readable.boardId, title: "Keyed" }))
    expect(task.key).toMatch(/^BULKOK-\d+$/)
    expect(task.projectKey).toBe("BULKOK")
  })
})
