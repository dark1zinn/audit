import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Conflict, Forbidden, NotFound, RateLimited, ValidationError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { AiConversationId, AiProposalId, AiProviderId } from "../ids.ts"
import { AiUnavailable } from "./errors.ts"
import {
  AiActionInput,
  AiActionResult,
  AiChatResult,
  AiConversation,
  AiConversationDetail,
  AiPreferences,
  AiProposal,
  AiProvider,
  AiProviderInput,
  AiProviderPatch,
  AiSettings,
  AiSettingsInput,
  AiStatus,
  AiUsageReport,
  ChatInput,
  ConnectionTestResult,
  CreateConversationInput,
} from "./schema.ts"

const providerParams = { params: { providerId: AiProviderId } }
const conversationParams = { params: { conversationId: AiConversationId } }
const proposalParams = { params: { proposalId: AiProposalId } }

const AiErrors = [Forbidden, ValidationError, Conflict, NotFound, RateLimited, AiUnavailable]

/** Workspace AI administration; owners and admins only (each command checks `ai.configure`). */
export const AiAdminApi = HttpApiGroup.make("aiAdmin")
  .add(
    HttpApiEndpoint.get("settings", "/api/admin/ai/settings", {
      success: AiSettings,
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateSettings", "/api/admin/ai/settings", {
      payload: AiSettingsInput,
      success: AiSettings,
      error: [Forbidden, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.get("providers", "/api/admin/ai/providers", {
      success: Schema.Array(AiProvider),
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.post("createProvider", "/api/admin/ai/providers", {
      payload: AiProviderInput,
      success: AiProvider,
      error: [Forbidden, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateProvider", "/api/admin/ai/providers/:providerId", {
      ...providerParams,
      payload: AiProviderPatch,
      success: AiProvider,
      error: [Forbidden, NotFound, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteProvider", "/api/admin/ai/providers/:providerId", {
      ...providerParams,
      success: Schema.Void,
      error: [Forbidden, NotFound, Conflict],
    }),
  )
  .add(
    HttpApiEndpoint.post("testProvider", "/api/admin/ai/providers/:providerId/test", {
      ...providerParams,
      success: ConnectionTestResult,
      error: [Forbidden, NotFound, RateLimited],
    }),
  )
  .add(
    HttpApiEndpoint.get("usage", "/api/admin/ai/usage", {
      query: { month: Schema.optionalKey(Schema.String) },
      success: AiUsageReport,
      error: [Forbidden, ValidationError],
    }),
  )
  .middleware(Authentication)

/** The signed-in person's AI use: status, conversations, proposals, preferences and actions. */
export const AiApi = HttpApiGroup.make("ai")
  .add(
    HttpApiEndpoint.get("status", "/api/ai/status", {
      success: AiStatus,
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.get("conversations", "/api/ai/conversations", {
      success: Schema.Array(AiConversation),
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.post("createConversation", "/api/ai/conversations", {
      payload: CreateConversationInput,
      success: AiConversation,
      error: AiErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("conversation", "/api/ai/conversations/:conversationId", {
      ...conversationParams,
      success: AiConversationDetail,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteConversation", "/api/ai/conversations/:conversationId", {
      ...conversationParams,
      success: Schema.Void,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.post("chat", "/api/ai/conversations/:conversationId/messages", {
      ...conversationParams,
      payload: ChatInput,
      success: AiChatResult,
      error: AiErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("proposals", "/api/ai/proposals", {
      success: Schema.Array(AiProposal),
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.post("approveProposal", "/api/ai/proposals/:proposalId/approve", {
      ...proposalParams,
      success: AiProposal,
      error: AiErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("rejectProposal", "/api/ai/proposals/:proposalId/reject", {
      ...proposalParams,
      success: AiProposal,
      error: [Forbidden, NotFound, Conflict],
    }),
  )
  .add(
    HttpApiEndpoint.get("preferences", "/api/ai/preferences", {
      success: AiPreferences,
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updatePreferences", "/api/ai/preferences", {
      payload: AiPreferences,
      success: AiPreferences,
      error: [Forbidden, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.post("action", "/api/ai/actions", {
      payload: AiActionInput,
      success: AiActionResult,
      error: AiErrors,
    }),
  )
  .middleware(Authentication)
