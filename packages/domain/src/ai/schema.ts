import { Schema } from "effect"
import {
  AiConversationId,
  AiMessageId,
  AiProposalId,
  AiProviderId,
  BoardId,
  CalendarId,
  ChannelId,
  DocId,
  EntityId,
} from "../ids.ts"
import { WorkspaceRole } from "../roles.ts"

/** Workspace AI features; each can be switched off on its own. */
export const AiFeature = Schema.Literals([
  "assistant",
  "semantic_search",
  "summaries",
  "doc_upkeep",
  "editor",
  "chat",
  "board",
  "calendar",
])
export type AiFeature = typeof AiFeature.Type

export const AiProviderKind = Schema.Literals([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "openai_compatible",
])
export type AiProviderKind = typeof AiProviderKind.Type

export const AiProviderStatus = Schema.Literals(["untested", "ok", "failed"])

const ModelName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const Dimensions = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4000 }))

/** A provider as the admin sees it. The key is never returned, only its last four characters. */
export const AiProvider = Schema.Struct({
  id: AiProviderId,
  kind: AiProviderKind,
  name: Schema.String,
  baseUrl: Schema.String,
  chatModel: Schema.String,
  embeddingModel: Schema.String,
  embeddingDimensions: Schema.Int,
  hasKey: Schema.Boolean,
  keyLast4: Schema.NullOr(Schema.String),
  status: AiProviderStatus,
  lastTestedAt: Schema.NullOr(Schema.Date),
  lastTestError: Schema.NullOr(Schema.String),
})
export type AiProvider = typeof AiProvider.Type

/** Create input. `apiKey` is sealed on arrival and never echoed back. */
export const AiProviderInput = Schema.Struct({
  kind: AiProviderKind,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  baseUrl: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  apiKey: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  chatModel: ModelName,
  embeddingModel: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  embeddingDimensions: Schema.optionalKey(Dimensions),
})
export type AiProviderInput = typeof AiProviderInput.Type

/** Partial update. Sending `apiKey` replaces the stored key; an empty string clears it. */
export const AiProviderPatch = Schema.Struct({
  name: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  baseUrl: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  apiKey: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  chatModel: Schema.optionalKey(ModelName),
  embeddingModel: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  embeddingDimensions: Schema.optionalKey(Dimensions),
})
export type AiProviderPatch = typeof AiProviderPatch.Type

export const AiFeatureFlags = Schema.Struct({
  assistant: Schema.Boolean,
  semantic_search: Schema.Boolean,
  summaries: Schema.Boolean,
  doc_upkeep: Schema.Boolean,
  editor: Schema.Boolean,
  chat: Schema.Boolean,
  board: Schema.Boolean,
  calendar: Schema.Boolean,
})
export type AiFeatureFlags = typeof AiFeatureFlags.Type

/** Workspace AI configuration. `enabled` is off until an owner turns it on. */
export const AiSettings = Schema.Struct({
  enabled: Schema.Boolean,
  defaultProviderId: Schema.NullOr(AiProviderId),
  embeddingProviderId: Schema.NullOr(AiProviderId),
  allowedRoles: Schema.Array(WorkspaceRole),
  monthlyTokenBudget: Schema.NullOr(Schema.Int),
  features: AiFeatureFlags,
})
export type AiSettings = typeof AiSettings.Type

export const AiSettingsInput = Schema.Struct({
  enabled: Schema.Boolean,
  defaultProviderId: Schema.NullOr(AiProviderId),
  embeddingProviderId: Schema.NullOr(AiProviderId),
  allowedRoles: Schema.Array(WorkspaceRole),
  monthlyTokenBudget: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  features: AiFeatureFlags,
})
export type AiSettingsInput = typeof AiSettingsInput.Type

export const ConnectionTestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.String,
  latencyMs: Schema.Int,
})
export type ConnectionTestResult = typeof ConnectionTestResult.Type

/** Token usage for one calendar month (`YYYY-MM`, UTC). */
export const AiUsageRow = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  calls: Schema.Int,
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
})
export type AiUsageRow = typeof AiUsageRow.Type

export const AiUsageReport = Schema.Struct({
  month: Schema.String,
  totals: AiUsageRow,
  byFeature: Schema.Array(AiUsageRow),
  byPerson: Schema.Array(AiUsageRow),
  byProvider: Schema.Array(AiUsageRow),
})
export type AiUsageReport = typeof AiUsageReport.Type

/** The signed-in person's AI standing: whether they may use it and how much budget is left. */
export const AiStatus = Schema.Struct({
  enabled: Schema.Boolean,
  allowed: Schema.Boolean,
  features: AiFeatureFlags,
  monthlyTokenBudget: Schema.NullOr(Schema.Int),
  usedTokens: Schema.Int,
  hasProvider: Schema.Boolean,
})
export type AiStatus = typeof AiStatus.Type

export const AiPreferences = Schema.Struct({
  autoApproveTools: Schema.Array(Schema.String),
})
export type AiPreferences = typeof AiPreferences.Type

export const AiConversation = Schema.Struct({
  id: AiConversationId,
  title: Schema.String,
  contextEntityId: Schema.NullOr(EntityId),
  updatedAt: Schema.Date,
})
export type AiConversation = typeof AiConversation.Type

export const CreateConversationInput = Schema.Struct({
  title: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  contextEntityId: Schema.optionalKey(EntityId),
})
export type CreateConversationInput = typeof CreateConversationInput.Type

/** Message parts. `tool-call` and `tool-result` record what the assistant did; `proposal` points
 * at a write it wants a person to approve. */
export const AiPart = Schema.Union([
  Schema.TaggedStruct("text", { text: Schema.String }),
  Schema.TaggedStruct("tool-call", {
    callId: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
  Schema.TaggedStruct("tool-result", {
    callId: Schema.String,
    name: Schema.String,
    output: Schema.Unknown,
  }),
  Schema.TaggedStruct("proposal", { proposalId: AiProposalId }),
])
export type AiPart = typeof AiPart.Type

export const AiMessage = Schema.Struct({
  id: AiMessageId,
  role: Schema.Literals(["user", "assistant", "tool"]),
  parts: Schema.Array(AiPart),
  createdAt: Schema.Date,
})
export type AiMessage = typeof AiMessage.Type

export const AiConversationDetail = Schema.Struct({
  conversation: AiConversation,
  messages: Schema.Array(AiMessage),
})
export type AiConversationDetail = typeof AiConversationDetail.Type

export const ChatInput = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8000)),
})
export type ChatInput = typeof ChatInput.Type

/**
 * Stream messages the assistant emits while answering (`ai.chat`). The chat endpoint folds them
 * into the stored message, so clients receive the finished `AiChatResult`.
 */
export const AiChatStreamMessage = Schema.Union([
  Schema.TaggedStruct("ai.chat.delta", { text: Schema.String }),
  Schema.TaggedStruct("ai.chat.tool_call", {
    callId: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
  Schema.TaggedStruct("ai.chat.tool_result", {
    callId: Schema.String,
    name: Schema.String,
    output: Schema.Unknown,
  }),
  Schema.TaggedStruct("ai.chat.proposal", { proposalId: AiProposalId }),
  Schema.TaggedStruct("ai.chat.usage", {
    inputTokens: Schema.Int,
    outputTokens: Schema.Int,
  }),
  Schema.TaggedStruct("ai.chat.done", { messageId: AiMessageId }),
  Schema.TaggedStruct("ai.chat.error", { message: Schema.String }),
])
export type AiChatStreamMessage = typeof AiChatStreamMessage.Type

export const AiChatResult = Schema.Struct({
  messages: Schema.Array(AiMessage),
  proposals: Schema.Array(AiProposalId),
})
export type AiChatResult = typeof AiChatResult.Type

export const AiProposalStatus = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "expired",
  "failed",
])

export const AiProposal = Schema.Struct({
  id: AiProposalId,
  conversationId: Schema.NullOr(AiConversationId),
  command: Schema.String,
  preview: Schema.Unknown,
  status: AiProposalStatus,
  result: Schema.NullOr(Schema.Unknown),
  expiresAt: Schema.Date,
  decidedAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
})
export type AiProposal = typeof AiProposal.Type

/** Actions started from an editor, chat, board or calendar surface. Each one drafts output or
 * proposals; nothing is written without approval. */
export const AiActionInput = Schema.Union([
  Schema.Struct({
    surface: Schema.Literal("editor"),
    action: Schema.Literals(["rewrite", "summarize", "translate", "fix_grammar"]),
    docId: DocId,
    selection: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(20000))),
    targetLocale: Schema.optionalKey(Schema.Literals(["en", "pt-BR", "es"])),
  }),
  Schema.Struct({
    surface: Schema.Literal("chat"),
    action: Schema.Literals(["summarize_channel", "draft_reply"]),
    channelId: ChannelId,
  }),
  Schema.Struct({
    surface: Schema.Literal("board"),
    action: Schema.Literals(["triage", "summarize_column"]),
    boardId: BoardId,
  }),
  Schema.Struct({
    surface: Schema.Literal("calendar"),
    action: Schema.Literals(["suggest_agenda", "summarize_week"]),
    calendarId: CalendarId,
  }),
])
export type AiActionInput = typeof AiActionInput.Type

export const AiActionResult = Schema.Struct({
  text: Schema.NullOr(Schema.String),
  proposals: Schema.Array(AiProposalId),
})
export type AiActionResult = typeof AiActionResult.Type
