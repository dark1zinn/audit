import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { loadBoard } from "@audit/core/projects/board-read"
import { createProject, grantProjectAccess } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import {
  createComment,
  createTask,
  deleteTask,
  moveTask,
  updateTask,
} from "@audit/core/tasks/commands"
import type { BoardId, ColumnId, ProjectId, TaskId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person
let people: Record<Role, Person>
let boardId: BoardId
let doneColumnId: ColumnId

const roles = ["viewer", "commenter", "editor", "manager", "stranger"] as const
type Role = (typeof roles)[number]
type Outcome = Record<Role, string>

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

/** Runs `attempt` as each fixture person and records the tag of every outcome. */
const outcomes = async (
  attempt: (person: Person) => Promise<Exit.Exit<unknown, unknown>>,
): Promise<Outcome> => {
  const result = {} as Outcome
  for (const role of roles) result[role] = failureTag(await attempt(people[role]))
  return result
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "PERM", name: "Permissions", visibility: "restricted" }))
  const projectId = project.id as ProjectId
  boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId)))!
  const board = await runAs(database, owner.actor)(loadBoard(boardId))
  doneColumnId = board.columns[1]!.id as ColumnId

  const granted: Array<[Role, "viewer" | "commenter" | "editor" | "manager"]> = [
    ["viewer", "viewer"],
    ["commenter", "commenter"],
    ["editor", "editor"],
    ["manager", "manager"],
  ]
  const entries: Partial<Record<Role, Person>> = {}
  for (const [name, role] of granted) {
    const person = await addPerson(database, owner, name, "member")
    entries[name] = person
    await runAs(
      database,
      owner.actor,
    )(
      grantProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: person.userId,
        role,
      }),
    )
  }
  entries.stranger = await addPerson(database, owner, "stranger", "member")
  people = entries as Record<Role, Person>
})

afterAll(() => database.drop())

const create = (person: Person, title: string) =>
  runAs(database, person.actor)(createTask.execute({ boardId, title }))

describe("task commands by resource role", () => {
  test("task.create needs editor on the board", async () => {
    const result = await outcomes((person) =>
      exitAs(database, person.actor)(createTask.execute({ boardId, title: "Created" })),
    )
    expect(result).toEqual({
      viewer: "Forbidden",
      commenter: "Forbidden",
      editor: "success",
      manager: "success",
      stranger: "NotFound",
    })
  })

  test("task.update needs editor on the task", async () => {
    const task = await create(owner, "Update target")
    const result = await outcomes((person) =>
      exitAs(
        database,
        person.actor,
      )(updateTask.execute({ taskId: task.id as TaskId, title: "Renamed" })),
    )
    expect(result).toEqual({
      viewer: "Forbidden",
      commenter: "Forbidden",
      editor: "success",
      manager: "success",
      stranger: "NotFound",
    })
  })

  test("task.move needs editor on the task", async () => {
    const task = await create(owner, "Move target")
    const result = await outcomes((person) =>
      exitAs(
        database,
        person.actor,
      )(moveTask.execute({ taskId: task.id as TaskId, columnId: doneColumnId, afterTaskId: null })),
    )
    expect(result).toEqual({
      viewer: "Forbidden",
      commenter: "Forbidden",
      editor: "success",
      manager: "success",
      stranger: "NotFound",
    })
  })

  test("task.delete on own task needs only editor (delete_own)", async () => {
    const result = await outcomes(async (person) => {
      const task = await create(people.editor, "Editor's own")
      return exitAs(database, person.actor)(deleteTask.execute({ taskId: task.id as TaskId }))
    })
    expect(result).toEqual({
      viewer: "Forbidden",
      commenter: "Forbidden",
      editor: "success",
      manager: "success",
      stranger: "NotFound",
    })
  })

  test("task.delete on another's task needs manager", async () => {
    const result = await outcomes(async (person) => {
      const task = await create(owner, "Owner's task")
      return exitAs(database, person.actor)(deleteTask.execute({ taskId: task.id as TaskId }))
    })
    expect(result).toEqual({
      viewer: "Forbidden",
      commenter: "Forbidden",
      editor: "Forbidden",
      manager: "success",
      stranger: "NotFound",
    })
  })

  test("comment.create needs commenter", async () => {
    const task = await create(owner, "Comment target")
    const body = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    }
    const result = await outcomes((person) =>
      exitAs(database, person.actor)(createComment.execute({ taskId: task.id as TaskId, body })),
    )
    expect(result).toEqual({
      viewer: "Forbidden",
      commenter: "success",
      editor: "success",
      manager: "success",
      stranger: "NotFound",
    })
  })
})
