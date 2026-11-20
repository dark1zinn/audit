import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { rrf } from "@audit/core/ai/chunk"
import { runAiDigests, setAiDigest } from "@audit/core/ai/digest"
import { acceptDocSuggestion, reviewDoc } from "@audit/core/ai/doc-upkeep"
import { AiModels, type AiModelsShape } from "@audit/core/ai/models"
import { retrieveContext } from "@audit/core/ai/retrieval"
import { syncEntity } from "@audit/core/ai/sync"
import { createDoc } from "@audit/core/docs/commands"
import { saveDocContent } from "@audit/core/docs/content"
import { createProject, setBoardRestricted } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import { type Actor, CurrentActor } from "@audit/domain/actor"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { BoardId, DocId, EntityId, ProjectId, TaskId } from "@audit/domain/ids"
import {
  aiProviders,
  aiSettings,
  channels,
  comments,
  messages,
  references,
  trailEvents,
} from "@audit/db/schema"
import { Db } from "@audit/platform/database"
import { type FakeReply, fakeLanguageModel, fakeVector } from "@audit/ai/fake"
import { jsonToState } from "@audit/editor/ydoc"
import { makeTestDatabase, type TestDatabase, type TestServices } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace, system } from "@audit/testkit/fixtures"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as EmbeddingModel from "effect/ai/EmbeddingModel"

const DIMS = 1536
const EMBED_A = "embed-a"
const EMBED_B = "embed-b"
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
let member: Person
let providerId: string
let secretProjectId: ProjectId
let secretBoardId: BoardId
let secretTaskId: TaskId
let digestProjectId: ProjectId
let digestChannelId: EntityId

const spaceId = WORKSPACE_SPACE_ID as EntityId

/** Embedding layer that counts the texts it is asked to embed. */
const countingEmbeddings = (counter: { inputs: number }) =>
  Layer.effect(
    EmbeddingModel.EmbeddingModel,
    EmbeddingModel.make({
      embedMany: (request) =>
        Effect.sync(() => {
          counter.inputs += request.inputs.length
          return {
            results: request.inputs.map((text) => [...fakeVector(text, DIMS)]),
            usage: { inputTokens: 0 },
          }
        }),
    }),
  )

const modelsWith = (
  reply: (prompt: string) => FakeReply,
  counter = { inputs: 0 },
): AiModelsShape => ({
  language: () => fakeLanguageModel(reply),
  embedding: () => countingEmbeddings(counter),
})

const quiet = (): FakeReply => ({ text: "{}" })

const runWith = <A, E>(
  actor: Actor,
  models: AiModelsShape,
  effect: Effect.Effect<A, E, TestServices | CurrentActor | AiModels>,
) =>
  database.runtime.runPromise(
    effect.pipe(
      Effect.provideService(CurrentActor, actor),
      Effect.provideService(AiModels, models),
    ),
  )

const paragraph = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Mia", "member")

  providerId = await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const [provider] = yield* db
        .insert(aiProviders)
        .values({
          kind: "openai",
          name: "Test",
          chatModel: "chat-test",
          embeddingModel: EMBED_A,
          embeddingDimensions: DIMS,
        })
        .returning({ id: aiProviders.id })
        .pipe(Effect.orDie)
      if (provider === undefined) return yield* Effect.die("provider insert returned no row")
      yield* db
        .insert(aiSettings)
        .values({
          id: 1,
          enabled: true,
          defaultProviderId: provider.id,
          embeddingProviderId: provider.id,
          allowedRoles: ["owner", "admin", "member", "guest"],
          features: FEATURES,
        })
        .onConflictDoUpdate({
          target: aiSettings.id,
          set: {
            enabled: true,
            defaultProviderId: provider.id,
            embeddingProviderId: provider.id,
            allowedRoles: ["owner", "admin", "member", "guest"],
            features: FEATURES,
          },
        })
        .pipe(Effect.orDie)
      return provider.id
    }),
  )

  const secret = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "SEC", name: "Secret", visibility: "restricted" }))
  secretProjectId = secret.id as ProjectId
  secretBoardId = (await runAs(database, owner.actor)(defaultBoardId(secretProjectId)))!
  const task = await runAs(
    database,
    owner.actor,
  )(createTask.execute({ boardId: secretBoardId, title: "Nightjar codename launch plan" }))
  secretTaskId = task.id as TaskId
  await runWith(owner.actor, modelsWith(quiet), syncEntity(secretTaskId))

  const digest = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "DIG", name: "Digest", visibility: "restricted" }))
  digestProjectId = digest.id as ProjectId
  const [digestChannel] = await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.projectId, digestProjectId))
        .pipe(Effect.orDie)
    }),
  )
  digestChannelId = digestChannel?.id as EntityId
  const boardId = (await runAs(database, owner.actor)(defaultBoardId(digestProjectId)))!
  await runAs(database, owner.actor)(createTask.execute({ boardId, title: "Ship the digest week" }))
})

afterAll(async () => {
  await database.drop()
})

describe("retrieval no-leak", () => {
  test("restricted content never appears in retrieval for a user without access", async () => {
    const outsider = await runWith(
      member.actor,
      modelsWith(quiet),
      retrieveContext("Nightjar codename", {}, { limit: 10 }),
    )
    expect(outsider.map((chunk) => chunk.entityId)).not.toContain(secretTaskId)

    const insider = await runWith(
      owner.actor,
      modelsWith(quiet),
      retrieveContext("Nightjar codename", {}, { limit: 10 }),
    )
    expect(insider.map((chunk) => chunk.entityId)).toContain(secretTaskId)
  })
})

describe("embedding sync", () => {
  test("unchanged chunks are not re-embedded", async () => {
    const counter = { inputs: 0 }
    await runWith(owner.actor, modelsWith(quiet, counter), syncEntity(secretTaskId))
    const afterFirst = counter.inputs
    await runWith(owner.actor, modelsWith(quiet, counter), syncEntity(secretTaskId))
    expect(counter.inputs).toBe(afterFirst)
  })

  test("changing the embedding model re-embeds existing chunks", async () => {
    const counter = { inputs: 0 }
    await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .update(aiProviders)
          .set({ embeddingModel: EMBED_B })
          .where(eq(aiProviders.id, providerId))
          .pipe(Effect.orDie)
      }),
    )
    await runWith(owner.actor, modelsWith(quiet, counter), syncEntity(secretTaskId))
    expect(counter.inputs).toBeGreaterThan(0)
  })
})

describe("reciprocal rank fusion", () => {
  test("an entity ranked high in both lists comes first", () => {
    const fused = rrf([
      ["a", "b"],
      ["a", "c"],
    ])
    expect(fused[0]?.key).toBe("a")
    expect(fused.map((item) => item.key).sort()).toEqual(["a", "b", "c"])
  })
})

describe("doc upkeep", () => {
  test("creates an AI-tagged comment and accepting records the trail as the accepting user", async () => {
    const doc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: spaceId, title: "Launch notes" }))
    const docId = doc.id as DocId
    await runAs(
      database,
      owner.actor,
    )(
      saveDocContent.execute({
        docId,
        ydocState: jsonToState(paragraph("Sprint 12 is due Friday.")),
      }),
    )
    await database.superuser`update entities set restricted = true where id = ${docId}`
    await database.superuser`
      insert into access_entries (resource_id, principal_type, principal_id, role)
      values (${docId}, 'user', ${owner.userId}, 'editor')`
    await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .insert(references)
          .values({ sourceId: docId, targetId: secretTaskId, kind: "link" })
          .pipe(Effect.orDie)
      }),
    )

    const reply = (): FakeReply => ({
      text: JSON.stringify({
        findings: [
          {
            quote: "Sprint 12 is due Friday",
            replacement: "Sprint 12 is due Monday",
            reason: "The linked plan moved the deadline to Monday.",
          },
        ],
      }),
    })
    await runWith(system, modelsWith(reply), reviewDoc(docId))

    const suggestions = await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* db
          .select({ id: comments.id, ai: comments.ai })
          .from(comments)
          .where(eq(comments.targetId, docId))
          .pipe(Effect.orDie)
      }),
    )
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.ai?.["kind"]).toBe("doc_upkeep")
    expect(suggestions[0]?.ai?.["status"]).toBe("open")

    const commentId = suggestions[0]!.id as EntityId
    await runWith(owner.actor, modelsWith(quiet), acceptDocSuggestion.execute({ commentId }))

    const trail = await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* db
          .select({ actorId: trailEvents.actorId })
          .from(trailEvents)
          .where(
            and(eq(trailEvents.action, "doc.ai_edit_accepted"), eq(trailEvents.entityId, docId)),
          )
          .pipe(Effect.orDie)
      }),
    )
    expect(trail).toHaveLength(1)
    expect(trail[0]?.actorId).toBe(owner.userId)
  })

  test("a source a reader of the doc cannot see is not cited", async () => {
    const doc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: spaceId, title: "Shared plan" }))
    const docId = doc.id as DocId
    await runAs(
      database,
      owner.actor,
    )(
      saveDocContent.execute({
        docId,
        ydocState: jsonToState(paragraph("Sprint 12 is due Friday.")),
      }),
    )
    await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .insert(references)
          .values({ sourceId: docId, targetId: secretTaskId, kind: "link" })
          .pipe(Effect.orDie)
      }),
    )

    const reply = (): FakeReply => ({
      text: JSON.stringify({
        findings: [
          {
            quote: "Sprint 12 is due Friday",
            replacement: "Sprint 12 is due Monday",
            reason: "The linked plan moved the deadline to Monday.",
          },
        ],
      }),
    })
    await runWith(system, modelsWith(reply), reviewDoc(docId))

    const suggestions = await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* db
          .select({ id: comments.id })
          .from(comments)
          .where(eq(comments.targetId, docId))
          .pipe(Effect.orDie)
      }),
    )
    expect(suggestions).toHaveLength(0)
  })
})

describe("weekly digest", () => {
  const digestMessages = () =>
    runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* db
          .select({ generatedBy: messages.generatedBy, authorId: messages.authorId })
          .from(messages)
          .where(eq(messages.channelId, digestChannelId))
          .pipe(Effect.orDie)
      }),
    ).then((rows) => rows.filter((row) => row.generatedBy === "ai_digest"))

  const digestReply = (): FakeReply => ({ text: JSON.stringify({ summary: "- One task changed" }) })

  test("posts nothing for a project that has not opted in", async () => {
    await runWith(system, modelsWith(digestReply), runAiDigests.execute({}))
    expect(await digestMessages()).toHaveLength(0)
  })

  test("posts for a project that opted in, attributed to the person who enabled it", async () => {
    await runAs(
      database,
      owner.actor,
    )(setAiDigest.execute({ projectId: digestProjectId, enabled: true }))
    await runWith(system, modelsWith(digestReply), runAiDigests.execute({}))
    const posted = await digestMessages()
    expect(posted).toHaveLength(1)
    expect(posted[0]?.authorId).toBe(owner.userId)
  })

  test("leaves tasks under a restricted board out of the summary", async () => {
    const boardId = (await runAs(database, owner.actor)(defaultBoardId(digestProjectId)))!
    await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Secret acquisition plan" }))
    await runAs(database, owner.actor)(setBoardRestricted.execute({ boardId, restricted: true }))
    const prompts: string[] = []
    await runWith(
      system,
      modelsWith((prompt) => {
        prompts.push(prompt)
        return digestReply()
      }),
      runAiDigests.execute({}),
    )
    expect(prompts.join("\n")).not.toContain("Secret acquisition plan")
  })
})
