/**
 * One assistant turn, streamed. Each model step is a lazy stream: nothing reaches the provider
 * until the caller pulls it, so closing the RPC stream stops further model calls. Tool calls run
 * here as the AI actor; write tools only create proposals.
 */
import { aiConversations, aiMessages } from "@audit/db/schema"
import type { AiActor } from "@audit/domain/actor"
import { CurrentActor } from "@audit/domain/actor"
import type { AiChatStreamMessage, AiSettings } from "@audit/domain/ai/schema"
import { AiMessageId, AiProposalId } from "@audit/domain/ids"
import { Forbidden, NotFound } from "@audit/domain/errors"
import type { AiConversationId, AiProviderId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Effect, Schema, Stream } from "effect"
import * as LanguageModel from "effect/ai/LanguageModel"
import type * as Prompt from "effect/ai/Prompt"
import { Authz } from "../authz.ts"
import { recipientLocale } from "../notifications/locale.ts"
import { loadAiContext } from "./guard.ts"
import { AiModels } from "./models.ts"
import type { ToolRequirements } from "./requirements.ts"
import { findTool, toolkit } from "./tools.ts"
import { checkBudget, recordUsage } from "./usage.ts"
import type { ProviderConfig } from "@audit/ai/provider"

const MAX_STEPS = 6

export type AiPartRow =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool-call"
      readonly callId: string
      readonly name: string
      readonly input: unknown
    }
  | {
      readonly type: "tool-result"
      readonly callId: string
      readonly name: string
      readonly output: unknown
    }
  | { readonly type: "proposal"; readonly proposalId: string }

export interface MessageRow {
  readonly role: "user" | "assistant" | "tool"
  readonly parts: ReadonlyArray<AiPartRow>
}

type PromptMessage = Prompt.MessageEncoded

/** What one model step needs from the loaded AI context. */
interface StepContext {
  readonly userId: UserId
  readonly conversationId: AiConversationId
  readonly providerId: AiProviderId
  readonly chatModel: string
  readonly config: ProviderConfig
  readonly settings: AiSettings
}

const systemPrompt = (locale: string) =>
  [
    `You are the workspace assistant. Answer in the user's interface language (${locale}).`,
    "Read data with the read tools. For changes call the write tools: they create proposals that",
    "the user must approve. Never say a change happened unless a tool reported it was approved.",
  ].join(" ")

const textOf = (parts: ReadonlyArray<AiPartRow>) =>
  parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")

const assistantContent = (parts: ReadonlyArray<AiPartRow>) =>
  parts.flatMap((part): Array<Prompt.AssistantMessagePartEncoded> => {
    if (part.type === "text") return [{ type: "text", text: part.text }]
    if (part.type === "tool-call") {
      return [{ type: "tool-call", id: part.callId, name: part.name, params: part.input }]
    }
    return []
  })

const toolContent = (
  results: ReadonlyArray<{
    readonly callId: string
    readonly name: string
    readonly output: unknown
  }>,
) =>
  results.map((result) => ({
    type: "tool-result" as const,
    id: result.callId,
    name: result.name,
    result: result.output,
    isFailure: false,
  }))

/** Stored history back into prompt messages. */
export const toPromptMessages = (rows: ReadonlyArray<MessageRow>): Array<PromptMessage> =>
  rows.flatMap((row): Array<PromptMessage> => {
    if (row.role === "user") return [{ role: "user", content: textOf(row.parts) }]
    if (row.role === "assistant")
      return [{ role: "assistant", content: assistantContent(row.parts) }]
    return [
      {
        role: "tool",
        content: toolContent(
          row.parts.flatMap((part) =>
            part.type === "tool-result"
              ? [{ callId: part.callId, name: part.name, output: part.output }]
              : [],
          ),
        ),
      },
    ]
  })

const describeFailure = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error)

const saveMessage = (
  conversationId: AiConversationId,
  role: MessageRow["role"],
  parts: ReadonlyArray<AiPartRow>,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const id = crypto.randomUUID()
    yield* db
      .insert(aiMessages)
      .values({ id, conversationId, role, parts: [...parts] })
      .pipe(Effect.orDie)
    yield* db
      .update(aiConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId))
      .pipe(Effect.orDie)
    return id
  })

/** Runs one tool call as the AI actor. A failure becomes the call's output; the turn continues. */
const runCall = (
  call: { readonly id: string; readonly name: string; readonly params: unknown },
  conversationId: AiConversationId,
): Effect.Effect<unknown, never, ToolRequirements> => {
  const tool = findTool(call.name)
  return tool === undefined
    ? Effect.succeed<unknown>({ error: `unknown tool ${call.name}` })
    : tool.call(call.params, { conversationId }).pipe(Effect.map((result) => result.output))
}

type StreamEvent = AiChatStreamMessage

const eventsOf = (...items: ReadonlyArray<StreamEvent>) => Stream.fromIterable(items)

/**
 * Streams one model step, then either finishes or runs its tool calls and continues with the
 * next step. The step's effects run when the stream is pulled, so an interrupted stream runs no
 * further steps.
 */
const steps = (
  ctx: StepContext,
  messages: Array<PromptMessage>,
  depth: number,
): Stream.Stream<StreamEvent, unknown, ToolRequirements | AiModels> => {
  if (depth >= MAX_STEPS) {
    return eventsOf({
      _tag: "ai.chat.error",
      message: "The assistant stopped after too many steps",
    })
  }
  return Stream.unwrap(
    Effect.gen(function* () {
      yield* checkBudget(ctx.userId, ctx.settings)
      const models = yield* AiModels
      const layer = models.language(ctx.config)
      const calls: Array<{ readonly id: string; readonly name: string; readonly params: unknown }> =
        []
      let text = ""
      let usage = { input: 0, output: 0 }
      const deltas = LanguageModel.streamText({
        prompt: messages,
        toolkit,
        disableToolCallResolution: true,
        toolCallValidation: "deferred",
      }).pipe(
        Stream.provide(layer),
        Stream.flatMap((part): Stream.Stream<StreamEvent> => {
          if (part.type === "text-delta") {
            text += part.delta
            return eventsOf({ _tag: "ai.chat.delta", text: part.delta })
          }
          if (part.type === "tool-call") {
            calls.push({ id: part.id, name: part.name, params: part.params })
            return Stream.empty
          }
          if (part.type === "finish") {
            usage = {
              input: part.usage.inputTokens.total ?? 0,
              output: part.usage.outputTokens.total ?? 0,
            }
          }
          return Stream.empty
        }),
      )
      const afterStep = Effect.gen(function* () {
        yield* recordUsage({
          userId: ctx.userId,
          providerId: ctx.providerId,
          feature: "assistant",
          model: ctx.chatModel,
          inputTokens: usage.input,
          outputTokens: usage.output,
        })
        const usageEvent: StreamEvent = {
          _tag: "ai.chat.usage",
          inputTokens: usage.input,
          outputTokens: usage.output,
        }
        const assistantParts: Array<AiPartRow> = [
          ...(text.length > 0 ? [{ type: "text" as const, text }] : []),
          ...calls.map((call) => ({
            type: "tool-call" as const,
            callId: call.id,
            name: call.name,
            input: call.params,
          })),
        ]
        if (calls.length === 0) {
          const messageId = yield* saveMessage(ctx.conversationId, "assistant", assistantParts)
          return eventsOf(usageEvent, {
            _tag: "ai.chat.done",
            messageId: Schema.decodeUnknownSync(AiMessageId)(messageId),
          })
        }
        const events: Array<StreamEvent> = [usageEvent]
        const results: Array<{
          readonly callId: string
          readonly name: string
          readonly output: unknown
        }> = []
        for (const call of calls) {
          events.push({
            _tag: "ai.chat.tool_call",
            callId: call.id,
            name: call.name,
            input: call.params,
          })
          const output = yield* runCall(call, ctx.conversationId).pipe(
            Effect.catch((error) => Effect.succeed<unknown>({ error: describeFailure(error) })),
          )
          results.push({ callId: call.id, name: call.name, output })
          events.push({ _tag: "ai.chat.tool_result", callId: call.id, name: call.name, output })
          // A proposal card is shown only while the proposal awaits the person.
          const proposalId =
            typeof output === "object" &&
            output !== null &&
            "proposalId" in output &&
            typeof output.proposalId === "string" &&
            "status" in output &&
            output.status === "pending"
              ? output.proposalId
              : null
          if (proposalId !== null) {
            events.push({
              _tag: "ai.chat.proposal",
              proposalId: Schema.decodeUnknownSync(AiProposalId)(proposalId),
            })
            assistantParts.push({ type: "proposal", proposalId })
          }
        }
        yield* saveMessage(ctx.conversationId, "assistant", assistantParts)
        yield* saveMessage(
          ctx.conversationId,
          "tool",
          results.map((result) => ({
            type: "tool-result" as const,
            callId: result.callId,
            name: result.name,
            output: result.output,
          })),
        )
        const nextMessages: Array<PromptMessage> = [
          ...messages,
          { role: "assistant", content: assistantContent(assistantParts) },
          { role: "tool", content: toolContent(results) },
        ]
        return Stream.fromIterable(events).pipe(Stream.concat(steps(ctx, nextMessages, depth + 1)))
      })
      return deltas.pipe(Stream.concat(Stream.unwrap(afterStep)))
    }),
  )
}

/**
 * Starts a turn: stores the user's message, loads history, and streams the reply. Refusals
 * (AI off, role, budget, no provider, not your conversation) fail before the stream starts;
 * failures during the turn arrive as an `ai.chat.error` message.
 */
export const chatTurn = (input: {
  readonly conversationId: AiConversationId
  readonly text: string
}) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const actor = yield* CurrentActor
      if (actor._tag !== "user") {
        return yield* new Forbidden({
          action: "ai.use",
          message: "Only people can use the assistant",
        })
      }
      const userId = actor.userId
      const loaded = yield* loadAiContext(userId, "assistant")
      const db = yield* Db
      const [conversation] = yield* db
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(eq(aiConversations.id, input.conversationId))
        .limit(1)
        .pipe(Effect.orDie)
      if (conversation === undefined) {
        return yield* new NotFound({ entity: "ai_conversation", id: input.conversationId })
      }
      const authz = yield* Authz
      const role = yield* authz.workspaceRole(userId)
      if (role === null)
        return yield* new Forbidden({ action: "ai.use", message: "No workspace role" })
      const locale = yield* recipientLocale(userId)
      yield* saveMessage(input.conversationId, "user", [{ type: "text", text: input.text }])
      const history = yield* db
        .select({ role: aiMessages.role, parts: aiMessages.parts })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, input.conversationId))
        .orderBy(aiMessages.createdAt)
        .pipe(Effect.orDie)
      const ctx: StepContext = {
        userId,
        conversationId: input.conversationId,
        providerId: loaded.providerId,
        chatModel: loaded.config.chatModel,
        config: loaded.config,
        settings: loaded.settings,
      }
      const aiActor: AiActor = { _tag: "ai", onBehalfOf: userId, role }
      const messages: Array<PromptMessage> = [
        { role: "system", content: systemPrompt(locale) },
        ...toPromptMessages(history as ReadonlyArray<MessageRow>),
      ]
      return steps(ctx, messages, 0).pipe(
        Stream.catch((error) =>
          eventsOf({ _tag: "ai.chat.error", message: describeFailure(error) }),
        ),
        Stream.provideService(CurrentActor, aiActor),
      )
    }),
  )
