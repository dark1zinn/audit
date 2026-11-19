import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chatTurn } from "@audit/core/ai/assistant"
import { createConversation, updatePreferences } from "@audit/core/ai/conversations"
import { approveProposal, rejectProposal } from "@audit/core/ai/proposals"
import { AiModels, type AiModelsShape } from "@audit/core/ai/models"
import {
  grantProjectAccess,
  revokeProjectAccess,
  createProject,
} from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import { type Actor, CurrentActor } from "@audit/domain/actor"
import type { AiChatStreamMessage } from "@audit/domain/ai/schema"
import type { BoardId, ProjectId } from "@audit/domain/ids"
import {
  aiProviders,
  aiSettings,
  aiUsage,
  boardColumns,
  entities,
  tasks,
  trailEvents,
} from "@audit/db/schema"
import { Db } from "@audit/platform/database"
import { fakeEmbeddingModel } from "@audit/ai/fake"
import { makeTestDatabase, type TestDatabase, type TestServices } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, Stream } from "effect"
import * as LanguageModel from "effect/ai/LanguageModel"
import type * as Response from "effect/ai/Response"

const DIMS = 1536
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
let projectId: ProjectId
let boardId: BoardId
let columnId: string
let providerId: string

/** One scripted model response: a list of stream parts. Each model call consumes one entry. */
type Script = ReadonlyArray<Response.StreamPartEncoded>

const finish = (inputTokens: number, outputTokens: number, reason: "stop" | "tool-calls") =>
  ({
    type: "finish",
    reason,
    usage: { inputTokens: { total: inputTokens }, outputTokens: { total: outputTokens } },
  }) as unknown as Response.StreamPartEncoded

const callTool = (name: string, params: unknown): Script => [
  {
    type: "tool-call",
    id: Bun.randomUUIDv7(),
    name,
    params,
  } as unknown as Response.StreamPartEncoded,
  finish(0, 0, "tool-calls"),
]

const sayText = (text: string, inputTokens = 0, outputTokens = 0): Script => [
  { type: "text-start", id: "t" } as unknown as Response.StreamPartEncoded,
  { type: "text-delta", id: "t", delta: text } as unknown as Response.StreamPartEncoded,
  { type: "text-end", id: "t" } as unknown as Response.StreamPartEncoded,
  finish(inputTokens, outputTokens, "stop"),
]

/** A chat model that replays `script` one entry per call and counts calls. */
const scripted = (script: ReadonlyArray<Script>, calls: { count: number }) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => Effect.die("generateText is not used by the assistant"),
      streamText: () =>
        Stream.suspend(() => {
          const entry = script[Math.min(calls.count, script.length - 1)] ?? []
          calls.count++
          return Stream.fromIterable(entry)
        }),
    }),
  )

const modelsWith = (script: ReadonlyArray<Script>, calls = { count: 0 }): AiModelsShape => ({
  language: () => scripted(script, calls),
  embedding: () => fakeEmbeddingModel({ dimensions: DIMS }),
})

const runAsActor = <A, E>(
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

const collect = (actor: Actor, models: AiModelsShape, conversationId: string, text: string) =>
  runAsActor(
    actor,
    models,
    chatTurn({ conversationId: conversationId as never, text }).pipe(Stream.runCollect),
  ).then((events) => Array.from(events) as Array<AiChatStreamMessage>)

const newConversation = (actor: Actor) =>
  runAs(database, actor)(createConversation.execute({ title: "Test" }))

const countTasks = (title: string) =>
  runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const rows = yield* db
        .select({ id: tasks.id })
        .from(tasks)
        .innerJoin(entities, eq(entities.id, tasks.id))
        .where(eq(entities.title, title))
        .pipe(Effect.orDie)
      return rows.length
    }),
  )

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
          embeddingModel: "embed-test",
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

  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "AIA", name: "Assistant", visibility: "restricted" }))
  projectId = project.id as ProjectId
  boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId)))!
  await runAs(
    database,
    owner.actor,
  )(
    grantProjectAccess.execute({
      projectId,
      principalType: "user",
      principalId: member.userId,
      role: "editor",
    }),
  )
  columnId = await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const [column] = yield* db
        .select({ id: boardColumns.id })
        .from(boardColumns)
        .where(eq(boardColumns.boardId, boardId))
        .limit(1)
        .pipe(Effect.orDie)
      return column!.id
    }),
  )
})

afterAll(async () => {
  await database?.drop()
})

describe("assistant writes", () => {
  test("a write is a proposal; nothing is created until approval", async () => {
    const calls = { count: 0 }
    const conversation = await newConversation(member.actor)
    const events = await collect(
      member.actor,
      modelsWith(
        [callTool("create_task", { columnId, title: "Approval gate task" }), sayText("Queued.")],
        calls,
      ),
      conversation.id,
      "create a task Approval gate task",
    )
    const proposal = events.find((event) => event._tag === "ai.chat.proposal")
    expect(proposal).toBeDefined()
    expect(await countTasks("Approval gate task")).toBe(0)
    expect(calls.count).toBe(2)
  })

  test("approval after access loss fails and writes nothing", async () => {
    const conversation = await newConversation(member.actor)
    const events = await collect(
      member.actor,
      modelsWith([callTool("create_task", { columnId, title: "Revoked task" }), sayText("ok")]),
      conversation.id,
      "create a task Revoked task",
    )
    const proposal = events.find((event) => event._tag === "ai.chat.proposal")
    if (proposal === undefined || proposal._tag !== "ai.chat.proposal")
      throw new Error("no proposal")

    await runAs(
      database,
      owner.actor,
    )(revokeProjectAccess.execute({ projectId, principalType: "user", principalId: member.userId }))

    const outcome = await runAsActor(
      member.actor,
      modelsWith([sayText("")]),
      approveProposal.execute({ proposalId: proposal.proposalId }).pipe(Effect.result),
    )
    expect(outcome._tag).toBe("Failure")
    expect(await countTasks("Revoked task")).toBe(0)

    await runAs(
      database,
      owner.actor,
    )(
      grantProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: member.userId,
        role: "editor",
      }),
    )
  })

  test("approved write creates the task and the trail shows actor ai on behalf of the user", async () => {
    const conversation = await newConversation(member.actor)
    const events = await collect(
      member.actor,
      modelsWith([callTool("create_task", { columnId, title: "Approved task" }), sayText("Done.")]),
      conversation.id,
      "create a task Approved task",
    )
    const proposal = events.find((event) => event._tag === "ai.chat.proposal")
    if (proposal === undefined || proposal._tag !== "ai.chat.proposal")
      throw new Error("no proposal")

    await runAsActor(
      member.actor,
      modelsWith([sayText("")]),
      approveProposal.execute({ proposalId: proposal.proposalId }),
    )
    expect(await countTasks("Approved task")).toBe(1)

    const trail = await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* db
          .select()
          .from(trailEvents)
          .where(and(eq(trailEvents.actorType, "ai"), eq(trailEvents.onBehalfOf, member.userId)))
          .pipe(Effect.orDie)
      }),
    )
    expect(trail.length).toBeGreaterThan(0)
  })

  test("reject leaves nothing behind", async () => {
    const conversation = await newConversation(member.actor)
    const events = await collect(
      member.actor,
      modelsWith([callTool("create_task", { columnId, title: "Rejected task" }), sayText("ok")]),
      conversation.id,
      "create a task Rejected task",
    )
    const proposal = events.find((event) => event._tag === "ai.chat.proposal")
    if (proposal === undefined || proposal._tag !== "ai.chat.proposal")
      throw new Error("no proposal")
    await runAsActor(
      member.actor,
      modelsWith([sayText("")]),
      rejectProposal.execute({ proposalId: proposal.proposalId }),
    )
    expect(await countTasks("Rejected task")).toBe(0)
  })
})

describe("auto-approve", () => {
  test("only auto-approvable tools may be enabled", async () => {
    const rejected = await runAsActor(
      member.actor,
      modelsWith([sayText("")]),
      updatePreferences.execute({ autoApproveTools: ["create_task"] }).pipe(Effect.result),
    )
    expect(rejected._tag).toBe("Failure")
  })

  test("an enabled low-risk tool runs without a proposal", async () => {
    await runAsActor(
      member.actor,
      modelsWith([sayText("")]),
      updatePreferences.execute({ autoApproveTools: ["link_entities"] }),
    )
    const first = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Link source" }))
    const second = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Link target" }))
    const conversation = await newConversation(member.actor)
    const events = await collect(
      member.actor,
      modelsWith([
        callTool("link_entities", { taskId: first.id, targetId: second.id, kind: "relates" }),
        sayText("Linked."),
      ]),
      conversation.id,
      "link them",
    )
    expect(events.some((event) => event._tag === "ai.chat.proposal")).toBe(false)
    await runAsActor(
      member.actor,
      modelsWith([sayText("")]),
      updatePreferences.execute({ autoApproveTools: [] }),
    )
  })
})

describe("budget and interruption", () => {
  test("the budget stops the loop with a clear error and no further model call", async () => {
    await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .update(aiSettings)
          .set({ monthlyTokenBudget: 5 })
          .where(eq(aiSettings.id, 1))
          .pipe(Effect.orDie)
      }),
    )
    const first = await newConversation(member.actor)
    await collect(member.actor, modelsWith([sayText("hi", 10, 10)]), first.id, "hello")
    const calls = { count: 0 }
    const second = await newConversation(member.actor)
    const events = await collect(
      member.actor,
      modelsWith([sayText("never")], calls),
      second.id,
      "again",
    )
    const error = events.find((event) => event._tag === "ai.chat.error")
    expect(error).toBeDefined()
    expect(calls.count).toBe(0)
    await runAs(
      database,
      owner.actor,
    )(
      Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .update(aiSettings)
          .set({ monthlyTokenBudget: null })
          .where(eq(aiSettings.id, 1))
          .pipe(Effect.orDie)
        yield* db
          .delete(aiUsage)
          .where(eq(aiUsage.providerId, providerId as never))
          .pipe(Effect.orDie)
      }),
    )
  })

  test("interrupting the stream stops further model calls", async () => {
    const calls = { count: 0 }
    const conversation = await newConversation(member.actor)
    const models = modelsWith(
      [
        callTool("search_workspace", { query: "x" }),
        callTool("search_workspace", { query: "y" }),
        sayText("end"),
      ],
      calls,
    )
    await runAsActor(
      member.actor,
      models,
      chatTurn({ conversationId: conversation.id as never, text: "search" }).pipe(
        Stream.take(1),
        Stream.runCollect,
      ),
    )
    expect(calls.count).toBeLessThanOrEqual(1)
  })
})
