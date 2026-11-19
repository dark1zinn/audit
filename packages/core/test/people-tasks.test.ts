import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as people from "@audit/core/people/commands"
import { createProject } from "@audit/core/projects/commands"
import { loadBoard } from "@audit/core/projects/board-read"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import type { ProjectId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person
let member: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Hal", "member")
})

afterAll(() => database.drop())

describe("people.deleteMember task handling", () => {
  test("open tasks move to the owner and done tasks are left untouched", async () => {
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "PEOPLE", name: "People" }))
    const boardId = await runAs(database, owner.actor)(defaultBoardId(project.id as ProjectId))
    if (boardId === null) throw new Error("project has no default board")
    const board = await runAs(database, owner.actor)(loadBoard(boardId))
    const todo = board.columns.find((column) => column.category === "todo")!
    const done = board.columns.find((column) => column.category === "done")!

    const open = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Open", columnId: todo.id, assignees: [member.userId] }))
    const closed = await runAs(
      database,
      owner.actor,
    )(
      createTask.execute({
        boardId,
        title: "Closed",
        columnId: done.id,
        assignees: [member.userId],
      }),
    )

    await runAs(database, owner.actor)(people.deleteMember.execute(member.userId))

    const openAssignees = await database.superuser`
      select user_id from task_assignees where task_id = ${open.id} order by user_id`
    expect(openAssignees.map((row: { user_id: string }) => row.user_id)).toEqual([owner.userId])

    const closedAssignees = await database.superuser`
      select user_id from task_assignees where task_id = ${closed.id}`
    expect(closedAssignees.map((row: { user_id: string }) => row.user_id)).toEqual([member.userId])
  })
})
