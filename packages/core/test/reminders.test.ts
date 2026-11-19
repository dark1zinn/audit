import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { loadBoard } from "@audit/core/projects/board-read"
import {
  createProject,
  grantProjectAccess,
  revokeProjectAccess,
} from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask, updateTask } from "@audit/core/tasks/commands"
import { myNotifications } from "@audit/core/notifications/queries"
import { remindDueSoon, remindOverdue } from "@audit/core/tasks/reminders"
import type { BoardId, ColumnId, ProjectId, TaskId, UserId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace, system } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person
let assignee: Person
let removed: Person
let projectId: ProjectId
let boardId: BoardId
let doneColumnId: ColumnId

const HOUR_MS = 60 * 60 * 1000

const remind = (kind: "soon" | "overdue") =>
  runAs(database, system)(kind === "soon" ? remindDueSoon.execute({}) : remindOverdue.execute({}))

const notificationsFor = async (person: Person, kind: string, taskId: TaskId) => {
  const items = await runAs(database, person.actor)(myNotifications(false))
  return items.filter((item) => item.kind === kind && item.entityId === taskId)
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  assignee = await addPerson(database, owner, "Ana", "member")
  removed = await addPerson(database, owner, "Rui", "member")

  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "REMIND", name: "Reminders", visibility: "restricted" }))
  projectId = project.id as ProjectId
  boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId)))!
  const board = await runAs(database, owner.actor)(loadBoard(boardId))
  doneColumnId = board.columns[3]!.id as ColumnId

  for (const person of [assignee, removed]) {
    await runAs(
      database,
      owner.actor,
    )(
      grantProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: person.userId,
        role: "editor",
      }),
    )
  }
})

afterAll(() => database.drop())

describe("due soon reminders", () => {
  test("notifies assignees once per due date, not again on a second run", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(
      createTask.execute({
        boardId,
        title: "Due soon",
        dueAt: new Date(Date.now() + 2 * HOUR_MS),
        assignees: [assignee.userId as UserId],
      }),
    )
    const taskId = task.id as TaskId

    await remind("soon")
    expect(await notificationsFor(assignee, "task_due_soon", taskId)).toHaveLength(1)

    await remind("soon")
    expect(await notificationsFor(assignee, "task_due_soon", taskId)).toHaveLength(1)
  })

  test("a new due date notifies again", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(
      createTask.execute({
        boardId,
        title: "Rescheduled",
        dueAt: new Date(Date.now() + 2 * HOUR_MS),
        assignees: [assignee.userId as UserId],
      }),
    )
    const taskId = task.id as TaskId
    await remind("soon")
    await runAs(
      database,
      owner.actor,
    )(
      updateTask.execute({
        taskId,
        dueAt: new Date(Date.now() + 3 * HOUR_MS),
      }),
    )
    await remind("soon")
    expect(await notificationsFor(assignee, "task_due_soon", taskId)).toHaveLength(2)
  })

  test("completed tasks are skipped", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(
      createTask.execute({
        boardId,
        title: "Already done",
        columnId: doneColumnId,
        dueAt: new Date(Date.now() + 2 * HOUR_MS),
        assignees: [assignee.userId as UserId],
      }),
    )
    await remind("soon")
    expect(await notificationsFor(assignee, "task_due_soon", task.id as TaskId)).toHaveLength(0)
  })

  test("assignees who can no longer see the task get no notification", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(
      createTask.execute({
        boardId,
        title: "Access lost",
        dueAt: new Date(Date.now() + 2 * HOUR_MS),
        assignees: [removed.userId as UserId],
      }),
    )
    await runAs(
      database,
      owner.actor,
    )(
      revokeProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: removed.userId,
      }),
    )
    await remind("soon")
    expect(await notificationsFor(removed, "task_due_soon", task.id as TaskId)).toHaveLength(0)
  })
})

describe("overdue reminders", () => {
  test("notifies assignees of overdue tasks once", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(
      createTask.execute({
        boardId,
        title: "Overdue",
        dueAt: new Date(Date.now() - HOUR_MS),
        assignees: [assignee.userId as UserId],
      }),
    )
    const taskId = task.id as TaskId
    await remind("overdue")
    await remind("overdue")
    expect(await notificationsFor(assignee, "task_overdue", taskId)).toHaveLength(1)
  })
})
