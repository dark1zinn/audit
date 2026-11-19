import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  createDoc,
  createDocVersion,
  deleteDoc,
  importDoc,
  restoreDocVersion,
} from "@audit/core/docs/commands"
import { docFreshness } from "@audit/core/docs/freshness"
import { exportDoc, loadDocState, saveDocContent } from "@audit/core/docs/content"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { DocId, DocVersionId, EntityId } from "@audit/domain/ids"
import { jsonToState } from "@audit/editor/ydoc"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Exit } from "effect"

let database: TestDatabase
let owner: Person
let member: Person

const spaceId = WORKSPACE_SPACE_ID as EntityId

const paragraph = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

const save = (docId: DocId, text: string) =>
  runAs(
    database,
    owner.actor,
  )(saveDocContent.execute({ docId, ydocState: jsonToState(paragraph(text)) }))

const createOwnedDoc = (title: string) =>
  runAs(
    database,
    owner.actor,
  )(createDoc.execute({ parentId: spaceId, title })).then((doc) => doc.id as DocId)

const count = async (sql: Promise<Array<{ n: number }>>) => (await sql)[0]?.n ?? 0

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Mia", "member")
})

afterAll(() => database.drop())

describe("doc content", () => {
  test("owner can create a space doc right after setup", async () => {
    const docId = await createOwnedDoc("Owner doc")
    expect(docId).toBeString()
  })

  test("saving content stores JSON and searchable text", async () => {
    const docId = await createOwnedDoc("Saved")
    await save(docId, "hello searchable world")
    const state = await runAs(database, owner.actor)(loadDocState(docId))
    expect(JSON.stringify(state.content)).toContain("hello searchable world")
    const [row] = await database.superuser<
      Array<{ content_text: string }>
    >`select content_text from docs where id = ${docId}`
    expect(row?.content_text).toContain("hello searchable world")
  })

  test("restoring a version replaces content and records doc.version_restored", async () => {
    const docId = await createOwnedDoc("Versioned")
    await save(docId, "first draft")
    const version = await runAs(
      database,
      owner.actor,
    )(createDocVersion.execute({ docId, label: "v1" }))
    await save(docId, "second draft")

    await runAs(
      database,
      owner.actor,
    )(restoreDocVersion.execute({ docId, versionId: version.id as DocVersionId }))

    const state = await runAs(database, owner.actor)(loadDocState(docId))
    expect(JSON.stringify(state.content)).toContain("first draft")
    expect(JSON.stringify(state.content)).not.toContain("second draft")
    const restored = await count(
      database.superuser`select count(*)::int as n from trail_events
        where action = 'doc.version_restored' and entity_id = ${docId}`,
    )
    expect(restored).toBe(1)
  })

  test("markdown import then export keeps the heading and emphasised text", async () => {
    const doc = await runAs(
      database,
      owner.actor,
    )(
      importDoc.execute({
        parentId: spaceId,
        title: "Imported",
        markdown: "# Heading\n\nHello **world**",
      }),
    )
    const exported = await runAs(database, owner.actor)(exportDoc(doc.id as DocId, "md"))
    expect(exported.body).toContain("Heading")
    expect(exported.body).toContain("**world**")
  })
})

describe("doc freshness", () => {
  test("a due doc notifies its owner once per review interval", async () => {
    const docId = await createOwnedDoc("Review me")
    await database.superuser`update docs set review_every_days = 1, owner_user_id = ${owner.userId},
      verified_at = now() - interval '3 days', review_notified_at = null where id = ${docId}`
    const notifications = () =>
      count(
        database.superuser`select count(*)::int as n from notifications
          where kind = 'doc_review_due' and entity_id = ${docId}`,
      )

    await runAs(database, owner.actor)(docFreshness.execute({}))
    expect(await notifications()).toBe(1)

    await runAs(database, owner.actor)(docFreshness.execute({}))
    expect(await notifications()).toBe(1)

    await database.superuser`update docs set review_notified_at = now() - interval '2 days'
      where id = ${docId}`
    await runAs(database, owner.actor)(docFreshness.execute({}))
    expect(await notifications()).toBe(2)
  })
})

describe("deleting workspace docs", () => {
  test("members delete docs they created but not other people's; owners delete any", async () => {
    const mine = await runAs(
      database,
      member.actor,
    )(createDoc.execute({ parentId: spaceId, title: "Mia's notes" }))
    const ownersDoc = await createOwnedDoc("Handbook")

    const denied = await exitAs(database, member.actor)(deleteDoc.execute({ docId: ownersDoc }))
    expect(Exit.isFailure(denied)).toBe(true)

    await runAs(database, member.actor)(deleteDoc.execute({ docId: mine.id as DocId }))
    await runAs(database, owner.actor)(deleteDoc.execute({ docId: ownersDoc }))
    const deleted = await database.superuser<Array<{ n: number }>>`
      select count(*)::int as n from entities
      where id in (${mine.id}, ${ownersDoc}) and deleted_at is not null`
    expect(deleted[0]?.n).toBe(2)
  })
})
