import { afterAll, beforeAll, expect, test } from "bun:test"
import { createProvider } from "@audit/core/ai/commands"
import { createConversation } from "@audit/core/ai/conversations"
import { approveProposal, listProposals, proposeChange } from "@audit/core/ai/proposals"
import { docEditRequest } from "@audit/core/ai/tool-commands"
import { importDoc } from "@audit/core/docs/commands"
import { aiSettings, docs, trailEvents } from "@audit/db/schema"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { AiConversationId, DocId, EntityId } from "@audit/domain/ids"
import { markdownToJson } from "@audit/editor/markdown"
import { stateToJson } from "@audit/editor/ydoc"
import { Db } from "@audit/platform/database"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

const PreviewWithDiff = Schema.Struct({
  diff: Schema.Struct({ before: Schema.String, after: Schema.String }),
})

const FEATURES = {
  assistant: true,
  semantic_search: true,
  summaries: true,
  doc_upkeep: true,
  editor: true,
  chat: true,
  board: true,
  calendar: true,
}

let database: TestDatabase
let owner: Person
let docId: DocId
let conversationId: AiConversationId

const OLD = "# Plan\n\nOld text here."
const NEW = "# Plan\n\nNew text replaces it."

const readRow = () =>
  runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db.select().from(docs).where(eq(docs.id, docId)).pipe(Effect.orDie)
      return row
    }),
  )

const readAiEdits = () =>
  runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select()
        .from(trailEvents)
        .where(eq(trailEvents.action, "doc.ai_edit_applied"))
        .pipe(Effect.orDie)
    }),
  )

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  const provider = await runAs(
    database,
    owner.actor,
  )(
    createProvider.execute({
      kind: "openai_compatible",
      name: "Doc edit",
      baseUrl: "https://llm.test/v1",
      apiKey: "sk-test-DOCEDIT-1111",
      chatModel: "chat-test",
    }),
  )
  await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      yield* db
        .insert(aiSettings)
        .values({
          id: 1,
          enabled: true,
          allowedRoles: ["owner", "admin", "member", "guest"],
          features: FEATURES,
          defaultProviderId: provider.id as never,
        })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
    }),
  )
  const doc = await runAs(
    database,
    owner.actor,
  )(importDoc.execute({ parentId: WORKSPACE_SPACE_ID as EntityId, markdown: OLD, title: "Plan" }))
  docId = doc.id as DocId
  const conversation = await runAs(
    database,
    owner.actor,
  )(createConversation.execute({ title: "Edit" }))
  conversationId = conversation.id
}, 60_000)

afterAll(() => database.drop())

test("a proposed doc edit changes nothing until approved, then applies through the restore path", async () => {
  const draft = await runAs(database, owner.actor)(docEditRequest({ docId, markdown: NEW }))
  const outcome = await runAs(
    database,
    owner.actor,
  )(
    proposeChange.execute({
      ...draft,
      tool: "propose_doc_edit",
      autoApprovable: false,
      conversationId,
    }),
  )
  expect(outcome.status).toBe("pending")

  const before = await readRow()
  expect(before?.contentText).toContain("Old text here.")

  const proposals = await runAs(database, owner.actor)(listProposals(conversationId))
  const listed = proposals.find((proposal) => proposal.id === outcome.proposalId)
  expect(listed).toBeDefined()
  const { diff } = Schema.decodeUnknownSync(PreviewWithDiff)(listed?.preview)
  expect(diff.before).toContain("Old text here.")
  expect(diff.after).toContain("New text replaces it.")

  await runAs(database, owner.actor)(approveProposal.execute({ proposalId: outcome.proposalId }))

  const after = await readRow()
  expect(after?.contentText).toContain("New text replaces it.")
  expect(after?.contentText).not.toContain("Old text here.")
  expect(stateToJson(after?.ydoc ?? null)).toEqual(markdownToJson(NEW))

  const trail = await readAiEdits()
  expect(trail).toHaveLength(1)
  expect(trail[0]?.entityId).toBe(docId)
})
