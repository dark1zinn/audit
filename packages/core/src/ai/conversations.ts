/**
 * The signed-in person's assistant state: conversations, auto-approve preferences and standing.
 * Conversations are private to their owner, so every read filters by the actor and every write
 * is a command that checks the same ownership.
 */
import { aiConversations, aiMessages, aiUsage, aiUserPreferences } from "@audit/db/schema"
import { CurrentActor } from "@audit/domain/actor"
import type { AiConversation as AiConversationRow } from "@audit/domain/ai/schema"
import {
  AiConversation,
  AiConversationDetail,
  AiMessage,
  AiPreferences,
  AiStatus,
  CreateConversationInput,
} from "@audit/domain/ai/schema"
import { AiUnavailable } from "@audit/domain/ai/errors"
import { Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { AiConversationId, type UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, desc, eq, gte, sql } from "drizzle-orm"
import { Effect, Schema, Stream } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { readAiSettings } from "./settings.ts"
import { loadAiContext } from "./guard.ts"
import { findTool } from "./tools.ts"
import { type AiPartRow, chatTurn } from "./assistant.ts"

const LIST_LIMIT = 50

/** The signed-in user; the assistant is for people only. */
const currentUserId = Effect.gen(function* () {
  const actor = yield* CurrentActor
  if (actor._tag !== "user") {
    return yield* new Forbidden({ action: "ai.use", message: "Only people can use the assistant" })
  }
  return actor.userId
})

const toConversation = (row: {
  readonly id: string
  readonly title: string
  readonly contextEntityId: string | null
  readonly updatedAt: Date
}): AiConversationRow =>
  Schema.decodeUnknownSync(AiConversation)({
    id: row.id,
    title: row.title,
    contextEntityId: row.contextEntityId,
    updatedAt: row.updatedAt,
  })

/** Fails NotFound unless the conversation exists and belongs to `userId`. */
const ownConversation = (userId: UserId, conversationId: AiConversationId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: aiConversations.id,
        title: aiConversations.title,
        contextEntityId: aiConversations.contextEntityId,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
      .limit(1)
      .pipe(Effect.orDie)
    if (row === undefined) {
      return yield* new NotFound({ entity: "ai_conversation", id: conversationId })
    }
    return toConversation(row)
  })

export const createConversation = Command.make("ai.conversation.create", {
  input: CreateConversationInput,
  output: AiConversation,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUserId
      yield* loadAiContext(userId, "assistant")
      const db = yield* Db
      const id = Schema.decodeUnknownSync(AiConversationId)(crypto.randomUUID())
      const now = new Date()
      const contextEntityId = input.contextEntityId ?? null
      yield* db.insert(aiConversations).values({
        id,
        userId,
        title: input.title ?? "",
        contextEntityId,
        createdAt: now,
        updatedAt: now,
      })
      return toConversation({ id, title: input.title ?? "", contextEntityId, updatedAt: now })
    }),
})

export const deleteConversation = Command.make("ai.conversation.delete", {
  input: Schema.Struct({ conversationId: AiConversationId }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUserId
      yield* ownConversation(userId, input.conversationId)
      const db = yield* Db
      yield* db.delete(aiConversations).where(eq(aiConversations.id, input.conversationId))
    }),
})

export const listConversations = Effect.gen(function* () {
  const userId = yield* currentUserId
  const db = yield* Db
  const rows = yield* db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      contextEntityId: aiConversations.contextEntityId,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .where(eq(aiConversations.userId, userId))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(LIST_LIMIT)
    .pipe(Effect.orDie)
  return rows.map(toConversation)
})

export const conversationDetail = (conversationId: AiConversationId) =>
  Effect.gen(function* () {
    const userId = yield* currentUserId
    const conversation = yield* ownConversation(userId, conversationId)
    const db = yield* Db
    const rows = yield* db
      .select({
        id: aiMessages.id,
        role: aiMessages.role,
        parts: aiMessages.parts,
        createdAt: aiMessages.createdAt,
      })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(aiMessages.createdAt)
      .pipe(Effect.orDie)
    // Parts are stored with a `type` key; the domain schema tags them with `_tag`.
    const messages = rows.map((row) =>
      Schema.decodeUnknownSync(AiMessage)({
        ...row,
        parts: (row.parts as ReadonlyArray<AiPartRow>).map(({ type, ...part }) => ({
          ...part,
          _tag: type,
        })),
      }),
    )
    return Schema.decodeUnknownSync(AiConversationDetail)({ conversation, messages })
  })

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

export const aiStatus = Effect.gen(function* () {
  const userId = yield* currentUserId
  const settings = yield* readAiSettings
  const authz = yield* Authz
  const role = yield* authz.workspaceRole(userId)
  const db = yield* Db
  const [usage] = yield* db
    .select({
      used: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, monthStart(new Date()))))
    .pipe(Effect.orDie)
  return Schema.decodeUnknownSync(AiStatus)({
    enabled: settings.enabled,
    allowed: settings.enabled && role !== null && settings.allowedRoles.includes(role),
    features: settings.features,
    monthlyTokenBudget: settings.monthlyTokenBudget,
    usedTokens: Number(usage?.used ?? 0),
    hasProvider: settings.defaultProviderId !== null,
  })
})

export const aiPreferences = Effect.gen(function* () {
  const userId = yield* currentUserId
  const db = yield* Db
  const [row] = yield* db
    .select({ autoApproveTools: aiUserPreferences.autoApproveTools })
    .from(aiUserPreferences)
    .where(eq(aiUserPreferences.userId, userId))
    .limit(1)
    .pipe(Effect.orDie)
  return { autoApproveTools: [...(row?.autoApproveTools ?? [])] }
})

/** Only tools marked auto-approvable can be switched on; the rest always need approval. */
export const updatePreferences = Command.make("ai.preferences.update", {
  input: AiPreferences,
  output: AiPreferences,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUserId
      for (const name of input.autoApproveTools) {
        const tool = findTool(name)
        if (tool === undefined || tool.kind !== "write" || !tool.autoApprovable) {
          return yield* new ValidationError({
            message: `${name} cannot be auto-approved`,
            field: "autoApproveTools",
          })
        }
      }
      const db = yield* Db
      const autoApproveTools = [...new Set(input.autoApproveTools)]
      yield* db
        .insert(aiUserPreferences)
        .values({ userId, autoApproveTools })
        .onConflictDoUpdate({
          target: aiUserPreferences.userId,
          set: { autoApproveTools, updatedAt: new Date() },
        })
      return { autoApproveTools }
    }),
})

/** Runs one turn to completion for the HTTP chat endpoint, folding the stream into its result. */
export const sendChat = (input: {
  readonly conversationId: AiConversationId
  readonly text: string
}) =>
  Effect.gen(function* () {
    const events = yield* chatTurn(input).pipe(Stream.runCollect)
    const failure = events.find((event) => event._tag === "ai.chat.error")
    if (failure !== undefined && failure._tag === "ai.chat.error") {
      return yield* new AiUnavailable({ message: failure.message })
    }
    const proposals = events.flatMap((event) =>
      event._tag === "ai.chat.proposal" ? [event.proposalId] : [],
    )
    const detail = yield* conversationDetail(input.conversationId)
    return { messages: detail.messages, proposals }
  })
