import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createDoc } from "@audit/core/docs/commands"
import { compactDocs } from "@audit/core/docs/compaction"
import { LiveDocuments } from "@audit/core/docs/live-documents"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { DocId, EntityId } from "@audit/domain/ids"
import { jsonToState, jsonToYdoc, stateToJson, ydocToState } from "@audit/editor/ydoc"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import {
  type Person,
  addPerson,
  exitAs,
  runAs,
  setupWorkspace,
  system,
} from "@audit/testkit/fixtures"
import { Effect, Exit } from "effect"

let database: TestDatabase
let owner: Person

const spaceId = WORKSPACE_SPACE_ID as EntityId
const threshold = 1024

const paragraph = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

/** Same content as `paragraph(text)`, but the state keeps the history of 2000 inserts and deletes. */
const bloatedState = (text: string) => {
  const ydoc = jsonToYdoc(paragraph(text))
  const scratch = ydoc.getText("scratch")
  for (let i = 0; i < 2000; i++) scratch.insert(0, "x")
  scratch.delete(0, scratch.length)
  return ydocToState(ydoc)
}

const createStoredDoc = async (title: string, ydoc: Uint8Array, text: string) => {
  const doc = await runAs(database, owner.actor)(createDoc.execute({ parentId: spaceId, title }))
  const docId = doc.id as DocId
  await database.superuser`
    update docs
    set ydoc = ${Buffer.from(ydoc)}, content = ${database.superuser.json(paragraph(text))}
    where id = ${docId}`
  return docId
}

const storedState = async (docId: DocId) => {
  const rows = await database.superuser<{ ydoc: Buffer; content: unknown }[]>`
    select ydoc, content from docs where id = ${docId}`
  const row = rows[0]
  if (!row) throw new Error("doc missing")
  return { bytes: row.ydoc.byteLength, state: new Uint8Array(row.ydoc), content: row.content }
}

const versionLabels = async (docId: DocId) => {
  const rows = await database.superuser<{ label: string | null; kind: string }[]>`
    select label, kind from doc_versions where doc_id = ${docId}`
  return [...rows]
}

const compact = (isOpen: (docId: DocId) => boolean = () => false) =>
  runAs(
    database,
    system,
  )(
    compactDocs
      .execute({ thresholdBytes: threshold })
      .pipe(Effect.provideService(LiveDocuments, { isOpen })),
  )

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop())

describe("doc compaction", () => {
  test("rebuilds a bloated doc smaller, keeps its content, and keeps the old state as a version", async () => {
    const docId = await createStoredDoc("bloated", bloatedState("kept text"), "kept text")
    const before = await storedState(docId)
    expect(before.bytes).toBeGreaterThan(threshold)

    await compact()

    const after = await storedState(docId)
    expect(after.bytes).toBeLessThan(before.bytes)
    expect(stateToJson(after.state)).toEqual(paragraph("kept text"))
    expect(after.content).toEqual(paragraph("kept text"))

    const versions = await versionLabels(docId)
    expect(versions).toContainEqual({ label: "Before compaction", kind: "auto" })
  })

  test("skips a doc that is open in a collaboration session", async () => {
    const docId = await createStoredDoc("open", bloatedState("open text"), "open text")
    const before = await storedState(docId)

    await compact(() => true)

    const after = await storedState(docId)
    expect(after.bytes).toBe(before.bytes)
    expect(await versionLabels(docId)).toEqual([])
  })

  test("leaves a doc already at or under the threshold alone", async () => {
    const small = jsonToState(paragraph("tiny"))
    const docId = await createStoredDoc("small", small, "tiny")
    const before = await storedState(docId)
    expect(before.bytes).toBeLessThanOrEqual(threshold)

    await compact()

    const after = await storedState(docId)
    expect(after.bytes).toBe(before.bytes)
    expect(await versionLabels(docId)).toEqual([])
  })

  test("is refused for a member without workspace settings", async () => {
    const member = await addPerson(database, owner, "Mia", "member")
    const exit = await exitAs(
      database,
      member.actor,
    )(compactDocs.execute({}).pipe(Effect.provideService(LiveDocuments, { isOpen: () => false })))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
