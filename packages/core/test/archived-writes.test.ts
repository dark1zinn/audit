import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createDoc } from "@audit/core/docs/commands"
import { saveDocContent } from "@audit/core/docs/content"
import { uploadFile } from "@audit/core/files/commands"
import { archiveProject, createProject } from "@audit/core/projects/commands"
import type { DocId, ProjectId } from "@audit/domain/ids"
import { jsonToState } from "@audit/editor/ydoc"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Exit } from "effect"

let database: TestDatabase
let owner: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

describe("archived projects reject content writes", () => {
  test("a doc in an archived project cannot be saved, nor a file uploaded into it", async () => {
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "FROZEN", name: "Frozen" }))
    const projectId = project.id as ProjectId
    const doc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: projectId, title: "Notes" }))
    await runAs(database, owner.actor)(archiveProject.execute({ projectId }))

    const saved = await exitAs(
      database,
      owner.actor,
    )(
      saveDocContent.execute({
        docId: doc.id as DocId,
        ydocState: jsonToState({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Late edit" }] }],
        }),
      }),
    )
    expect(Exit.isFailure(saved)).toBe(true)

    const uploaded = await exitAs(
      database,
      owner.actor,
    )(
      uploadFile.execute({
        parentId: projectId,
        name: "late.pdf",
        bytes: new TextEncoder().encode("%PDF-1.4\n"),
      }),
    )
    expect(Exit.isFailure(uploaded)).toBe(true)
  })
})
