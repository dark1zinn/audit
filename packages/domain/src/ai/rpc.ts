import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Forbidden, NotFound, ValidationError } from "../errors.ts"
import { RpcAuthentication } from "../http.ts"
import { AiConversationId } from "../ids.ts"
import { AiUnavailable } from "./errors.ts"
import { AiChatStreamMessage, ChatInput } from "./schema.ts"

export const AiChatRpcInput = Schema.Struct({
  conversationId: AiConversationId,
  text: ChatInput.fields.text,
})
export type AiChatRpcInput = typeof AiChatRpcInput.Type

/**
 * Streams one assistant turn. Closing the stream interrupts the turn: the fiber stops, the provider
 * request is aborted and no further model calls run.
 */
export class AiRpcs extends RpcGroup.make(
  Rpc.make("ai.chat", {
    payload: AiChatRpcInput,
    success: AiChatStreamMessage,
    error: Schema.Union([Forbidden, NotFound, ValidationError, AiUnavailable]),
    stream: true,
  }),
).middleware(RpcAuthentication) {}
