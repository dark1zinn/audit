import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { deleteProject, restoreProject, createProject } from "@audit/core/projects/commands"
import { sidebarProjects } from "@audit/core/projects/queries"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import { listTasks } from "@audit/core/tasks/queries"
import type { BoardId, ProjectId, TaskId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
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

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
})

afterAll(() => database.drop())

describe("project soft delete and restore", () => {
  test("delete needs the typed key to match", async () => {
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "LIFE", name: "Lifecycle" }))
    const exit = await exitAs(
      database,
      owner.actor,
    )(deleteProject.execute({ projectId: project.id as ProjectId, confirm: "WRONG" }))
    expect(failureTag(exit)).toBe("ValidationError")
  })

  test("a deleted project's tasks are hidden, and admin restore brings them back", async () => {
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "GONE", name: "Gone" }))
    const projectId = project.id as ProjectId
    const boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId))) as BoardId
    const task = await runAs(database, owner.actor)(createTask.execute({ boardId, title: "Kept" }))

    await runAs(database, owner.actor)(deleteProject.execute({ projectId, confirm: "GONE" }))

    const sidebar = await runAs(database, owner.actor)(sidebarProjects())
    expect(sidebar.map((item) => item.id)).not.toContain(projectId)
    const hidden = await exitAs(database, owner.actor)(listTasks(projectId, {}))
    expect(failureTag(hidden)).toBe("NotFound")

    await runAs(database, owner.actor)(restoreProject.execute({ projectId }))

    const restored = await runAs(database, owner.actor)(sidebarProjects())
    expect(restored.map((item) => item.id)).toContain(projectId)
    const board = await runAs(database, owner.actor)(listTasks(projectId, {}))
    const titles = board.groups.flatMap((group) => group.tasks.map((item) => item.id))
    expect(titles).toContain(task.id as TaskId)
  })

  test("creating a project with an existing key fails with Conflict", async () => {
    await runAs(database, owner.actor)(createProject.execute({ key: "DUPKEY", name: "First" }))
    const exit = await exitAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "DUPKEY", name: "Second" }))
    expect(failureTag(exit)).toBe("Conflict")
  })
})
