import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { exportWorkspace, workspaceExport } from "@audit/core/admin/commands"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Effect, Exit, Stream } from "effect"

let database: TestDatabase
let owner: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

/** Records the export, then drains the streamed body the route would send. */
const exportText = (person: Person) =>
  runAs(
    database,
    person.actor,
  )(
    Effect.gen(function* () {
      yield* exportWorkspace.execute({})
      const body = yield* workspaceExport
      const chunks: Array<Uint8Array> = []
      yield* Stream.runForEach(body, (chunk) => Effect.sync(() => chunks.push(chunk)))
      return new TextDecoder().decode(Buffer.concat(chunks))
    }),
  )

describe("workspace export", () => {
  test("refuses members who cannot change settings", async () => {
    const member = await addPerson(database, owner, "Mia", "member")
    const exit = await exitAs(database, member.actor)(exportWorkspace.execute({}))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("writes JSON Lines and never includes the VAPID keys", async () => {
    const out = await exportText(owner)
    const lines = out.split("\n").filter((line) => line.length > 0)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
    expect(out).not.toContain("vapid")
  })
})
