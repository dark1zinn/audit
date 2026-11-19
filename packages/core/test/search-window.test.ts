import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createProject } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { search } from "@audit/core/search/queries"
import { createTask } from "@audit/core/tasks/commands"
import type { BoardId, ProjectId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person
let reader: Person
const HIDDEN_COUNT = 510

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  reader = await addPerson(database, owner, "reader", "member")

  const hidden = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "HIDE", name: "Hidden", visibility: "restricted" }))
  const hiddenBoard = (await runAs(
    database,
    owner.actor,
  )(defaultBoardId(hidden.id as ProjectId))) as BoardId
  for (let i = 0; i < HIDDEN_COUNT; i++) {
    await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: hiddenBoard, title: `zebra hidden ${i}` }))
  }

  const open = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "OPEN", name: "Open", visibility: "workspace" }))
  const openBoard = (await runAs(
    database,
    owner.actor,
  )(defaultBoardId(open.id as ProjectId))) as BoardId
  for (const title of ["zebra open one", "zebra open two", "zebra open three"]) {
    await runAs(database, owner.actor)(createTask.execute({ boardId: openBoard, title }))
  }
}, 300_000)

afterAll(() => database.drop())

describe("search windows", () => {
  test("member gets visible matches after more than 500 invisible ones, paginated exactly", async () => {
    const first = await runAs(database, reader.actor)(search.execute({ q: "zebra", limit: 2 }))
    expect(first.hits.map((hit) => hit.title).sort()).toHaveLength(2)
    expect(first.hits.every((hit) => hit.title.startsWith("zebra open"))).toBe(true)
    expect(first.nextCursor).not.toBeNull()

    const second = await runAs(
      database,
      reader.actor,
    )(
      search.execute({
        q: "zebra",
        limit: 2,
        ...(first.nextCursor !== null ? { cursor: first.nextCursor } : {}),
      }),
    )
    expect(second.hits).toHaveLength(1)
    expect(second.hits[0]?.title.startsWith("zebra open")).toBe(true)
    expect(second.nextCursor).toBeNull()

    const seen = new Set([...first.hits, ...second.hits].map((hit) => hit.entityId))
    expect(seen.size).toBe(3)
  }, 120_000)

  test("owner sees hidden and open matches on the same query", async () => {
    const page = await runAs(database, owner.actor)(search.execute({ q: "zebra", limit: 50 }))
    expect(page.hits).toHaveLength(50)
    expect(page.nextCursor).not.toBeNull()
  }, 120_000)
})
