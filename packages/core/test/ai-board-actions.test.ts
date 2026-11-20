import { afterAll, beforeAll, expect, test } from "bun:test"
import { runAiAction } from "@audit/core/ai/actions"
import { createProvider } from "@audit/core/ai/commands"
import { AiModels, type AiModelsShape } from "@audit/core/ai/models"
import { listProposals } from "@audit/core/ai/proposals"
import { createProject } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import { CurrentActor } from "@audit/domain/actor"
import { fakeEmbeddingModel } from "@audit/ai/fake"
import { aiSettings, boardColumns, entities, tasks } from "@audit/db/schema"
import type { BoardId, ProjectId, TaskId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { makeTestDatabase, type TestDatabase, type TestServices } from "@audit/testkit/database"
import { type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { eq } from "drizzle-orm"
import { Effect, Exit, Layer, Stream } from "effect"
import * as LanguageModel from "effect/ai/LanguageModel"

const DIMS = 8

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
let boardId: BoardId
let columnIds: Array<string>
let parentId: TaskId
let strayId: TaskId
let parentColumnId: string

/** A model that answers every call with `text`. */
const replying = (text: string): AiModelsShape => ({
  language: () =>
    Layer.effect(
      LanguageModel.LanguageModel,
      LanguageModel.make({
        generateText: () =>
          Effect.succeed([
            { type: "text", text },
            {
              type: "finish",
              reason: "stop",
              usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
            },
          ] as never),
        streamText: () => Stream.empty,
      }),
    ),
  embedding: () => fakeEmbeddingModel({ dimensions: DIMS }),
})

const run = <A, E>(
  models: AiModelsShape,
  effect: Effect.Effect<A, E, TestServices | CurrentActor | AiModels>,
) =>
  database.runtime.runPromise(
    effect.pipe(
      Effect.provideService(CurrentActor, owner.actor),
      Effect.provideService(AiModels, models),
    ),
  )

const columnOf = (taskId: TaskId) =>
  runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db
        .select({ columnId: tasks.columnId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .pipe(Effect.orDie)
      return row?.columnId
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
      name: "Board actions",
      baseUrl: "https://93.184.216.34/v1",
      apiKey: "sk-test-BOARD-2222",
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
  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "BRD", name: "Board AI", visibility: "restricted" }))
  boardId = (await runAs(database, owner.actor)(defaultBoardId(project.id as ProjectId)))!
  const columns = await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select({ id: boardColumns.id })
        .from(boardColumns)
        .where(eq(boardColumns.boardId, boardId))
        .pipe(Effect.orDie)
    }),
  )
  columnIds = columns.map((column) => column.id)
  const parent = await runAs(
    database,
    owner.actor,
  )(createTask.execute({ boardId, title: "Ship release" }))
  parentId = parent.id as TaskId
  parentColumnId = (await columnOf(parentId))!
  const stray = await runAs(
    database,
    owner.actor,
  )(createTask.execute({ boardId, title: "Stray chore" }))
  strayId = stray.id as TaskId
}, 60_000)

afterAll(() => database.drop())

test("triage proposes only moves that match the board, as pending proposals", async () => {
  const target = columnIds.find((id) => id !== parentColumnId)!
  const reply = JSON.stringify({
    summary: "Board is busy.",
    suggestions: [
      { type: "move", taskId: parentId, columnId: target },
      { type: "move", taskId: "not-a-task", columnId: target },
      { type: "move", taskId: strayId, columnId: "not-a-column" },
    ],
  })
  const result = await run(
    replying(reply),
    runAiAction({ surface: "board", action: "triage", boardId }),
  )
  expect(result.text).toBe("Board is busy.")
  expect(result.proposals.length).toBe(1)
  const pending = await runAs(database, owner.actor)(listProposals(null))
  expect(pending.some((proposal) => proposal.id === result.proposals[0])).toBe(true)
  expect(await columnOf(parentId)).toBe(parentColumnId)
})

test("break down turns subtask suggestions into proposed tasks in the parent column", async () => {
  const reply = JSON.stringify({
    summary: "Two steps.",
    suggestions: [
      { type: "subtask", title: "Draft notes", description: "Outline the changes" },
      { type: "subtask", title: "   " },
      { type: "move", taskId: parentId, columnId: columnIds[0] },
    ],
  })
  const result = await run(
    replying(reply),
    runAiAction({ surface: "board", action: "break_down", boardId, taskId: parentId }),
  )
  expect(result.text).toBe("Two steps.")
  expect(result.proposals.length).toBe(1)
  const pending = await runAs(database, owner.actor)(listProposals(null))
  const proposal = pending.find((item) => item.id === result.proposals[0])
  expect(proposal).toBeDefined()
  expect(JSON.stringify(proposal?.preview)).toContain("Draft notes")
  const subtasks = await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.title, "Draft notes"))
    }),
  )
  expect(subtasks.length).toBe(0)
})

test("unparseable model output keeps its text and proposes nothing", async () => {
  const result = await run(
    replying("Sorry, no JSON here."),
    runAiAction({ surface: "board", action: "triage", boardId }),
  )
  expect(result.text).toBe("Sorry, no JSON here.")
  expect(result.proposals).toEqual([])
})

test("break down refuses a task that is not on the board", async () => {
  const exit = await run(
    replying("{}"),
    Effect.exit(
      runAiAction({
        surface: "board",
        action: "break_down",
        boardId,
        taskId: Bun.randomUUIDv7() as TaskId,
      }),
    ),
  )
  expect(Exit.isFailure(exit)).toBe(true)
})
