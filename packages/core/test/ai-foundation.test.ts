import { afterAll, beforeAll, expect, test } from "bun:test"
import { chatTurn } from "@audit/core/ai/assistant"
import { createProvider, testProvider } from "@audit/core/ai/commands"
import { createConversation } from "@audit/core/ai/conversations"
import { AiModels, type AiModelsShape } from "@audit/core/ai/models"
import { type Actor, CurrentActor } from "@audit/domain/actor"
import type { AiConversationId } from "@audit/domain/ids"
import { aiSettings, aiUsage, trailEvents } from "@audit/db/schema"
import { Db } from "@audit/platform/database"
import { makeTestDatabase, type TestDatabase, type TestServices } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { fakeEmbeddingModel } from "@audit/ai/fake"
import { eq } from "drizzle-orm"
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as LanguageModel from "effect/ai/LanguageModel"

const SECRET = "sk-test-SECRETKEY-9876"
const BASE_URL = "https://93.184.216.34/v1"
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
const ALL_ROLES = ["owner", "admin", "member", "guest"]

let database: TestDatabase
let owner: Person
let member: Person
let providerId: string
let conversationId: AiConversationId
const seenRequests: Array<string> = []
let fakeStatus = 200

const completion = JSON.stringify({
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 0,
  model: "chat-test",
  choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
})

/** The HTTP boundary: every provider request lands here and is recorded. */
const fakeHttp = HttpClient.make((request) =>
  Effect.sync(() => {
    seenRequests.push(request.url)
    const body = fakeStatus === 200 ? completion : JSON.stringify({ error: "invalid key" })
    return HttpClientResponse.fromWeb(
      request,
      new Response(body, { status: fakeStatus, headers: { "content-type": "application/json" } }),
    )
  }),
)

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) =>
          typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "",
        ),
        Option.getOrElse(() => "no-error"),
      )
    : "success"

const exitOf = <A, E>(
  actor: Actor,
  models: AiModelsShape,
  effect: Effect.Effect<A, E, TestServices | CurrentActor | AiModels>,
) =>
  database.runtime.runPromise(
    Effect.exit(
      effect.pipe(
        Effect.provideService(CurrentActor, actor),
        Effect.provideService(AiModels, models),
      ),
    ),
  )

/** Models that must never be reached; any call fails the test loudly. */
const noCallModels = (calls: { count: number }): AiModelsShape => ({
  language: () =>
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () => Effect.die("generateText is not used"),
        streamText: () =>
          Stream.suspend(() => {
            calls.count++
            return Stream.empty
          }),
      }),
    ),
  embedding: () => fakeEmbeddingModel({ dimensions: 1536 }),
})

const setSettings = (patch: Partial<typeof aiSettings.$inferInsert>) =>
  runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      yield* db.update(aiSettings).set(patch).where(eq(aiSettings.id, 1)).pipe(Effect.orDie)
    }),
  )

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Mia", "member")
  await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      yield* db
        .insert(aiSettings)
        .values({ id: 1, enabled: true, allowedRoles: ALL_ROLES, features: FEATURES })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
    }),
  )
  const provider = await runAs(
    database,
    owner.actor,
  )(
    createProvider.execute({
      kind: "openai_compatible",
      name: "Foundation",
      baseUrl: BASE_URL,
      apiKey: SECRET,
      chatModel: "chat-test",
    }),
  )
  providerId = provider.id
  await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      yield* db
        .update(aiSettings)
        .set({ defaultProviderId: providerId as never, embeddingProviderId: null })
        .where(eq(aiSettings.id, 1))
        .pipe(Effect.orDie)
    }),
  )
  const conversation = await runAs(
    database,
    member.actor,
  )(createConversation.execute({ title: "Foundation" }))
  conversationId = conversation.id
}, 60_000)

afterAll(() => database.drop())

test("keys never appear in command output or trail entries, only the last four digits", async () => {
  const created = await runAs(
    database,
    owner.actor,
  )(
    createProvider.execute({
      kind: "openai_compatible",
      name: "Leak check",
      baseUrl: BASE_URL,
      apiKey: SECRET,
      chatModel: "chat-test",
    }),
  )
  expect(created.keyLast4).toBe("9876")
  expect(JSON.stringify(created)).not.toContain("SECRETKEY")

  const rows = await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db.select().from(trailEvents).pipe(Effect.orDie)
    }),
  )
  expect(rows.length).toBeGreaterThan(0)
  expect(JSON.stringify(rows)).not.toContain("SECRETKEY")
})

test("connection test goes through the provider layer at the HTTP boundary", async () => {
  seenRequests.length = 0
  fakeStatus = 200
  const ok = await database.runtime.runPromise(
    testProvider
      .execute({ providerId: providerId as never })
      .pipe(
        Effect.provideService(CurrentActor, owner.actor),
        Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeHttp)),
      ),
  )
  expect(ok.ok).toBe(true)
  expect(seenRequests.some((url) => url.startsWith(BASE_URL))).toBe(true)
  expect(JSON.stringify(ok)).not.toContain("SECRETKEY")

  fakeStatus = 401
  const failed = await database.runtime.runPromise(
    testProvider
      .execute({ providerId: providerId as never })
      .pipe(
        Effect.provideService(CurrentActor, owner.actor),
        Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeHttp)),
      ),
  )
  expect(failed.ok).toBe(false)
  expect(JSON.stringify(failed)).not.toContain("SECRETKEY")
  fakeStatus = 200
})

test("AI disabled: every AI entry point refuses with AiUnavailable and calls no model", async () => {
  await setSettings({ enabled: false })
  const calls = { count: 0 }
  try {
    const created = await exitOf(
      member.actor,
      noCallModels(calls),
      createConversation.execute({ title: "Off" }),
    )
    expect(failureTag(created)).toBe("AiUnavailable")

    const streamed = await exitOf(
      member.actor,
      noCallModels(calls),
      chatTurn({ conversationId, text: "hello" }).pipe(Stream.runCollect),
    )
    expect(failureTag(streamed)).toBe("AiUnavailable")
    expect(calls.count).toBe(0)
  } finally {
    await setSettings({ enabled: true })
  }
})

test("roles outside allowedRoles are refused before any model call", async () => {
  await setSettings({ allowedRoles: ["owner", "admin", "guest"] })
  const calls = { count: 0 }
  try {
    const exit = await exitOf(
      member.actor,
      noCallModels(calls),
      chatTurn({ conversationId, text: "hello" }).pipe(Stream.runCollect),
    )
    expect(failureTag(exit)).toBe("Forbidden")
    expect(calls.count).toBe(0)
  } finally {
    await setSettings({ allowedRoles: ALL_ROLES })
  }
})

test("over the monthly budget: a clear refusal and no provider call", async () => {
  await setSettings({ monthlyTokenBudget: 100 })
  await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      yield* db
        .insert(aiUsage)
        .values({
          userId: member.userId,
          providerId: providerId as never,
          feature: "assistant",
          model: "chat-test",
          inputTokens: 150,
          outputTokens: 0,
        })
        .pipe(Effect.orDie)
    }),
  )
  const calls = { count: 0 }
  try {
    const exit = await exitOf(
      member.actor,
      noCallModels(calls),
      chatTurn({ conversationId, text: "hello again" }).pipe(Stream.runCollect),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    const events = Exit.isSuccess(exit) ? Array.from(exit.value) : []
    const errors = events.filter((event) => event._tag === "ai.chat.error")
    expect(errors.map((event) => event.message)).toEqual([
      "AI monthly budget reached for this month",
    ])
    expect(calls.count).toBe(0)
  } finally {
    await setSettings({ monthlyTokenBudget: null })
  }
})
