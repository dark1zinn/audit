import { AiRpcs } from "@audit/domain/ai/rpc"
import type { AiChatRpcInput } from "@audit/domain/ai/rpc"
import type { AiChatStreamMessage } from "@audit/domain/ai/schema"
import type { AiConversationId } from "@audit/domain/ids"
import { queryOptions } from "@tanstack/react-query"
import { Effect, Exit, Fiber, Stream } from "effect"
import { RpcClient } from "effect/rpc"
import { callApi } from "./api.ts"
import { ProtocolLive } from "./realtime.ts"

export const aiKeys = {
  status: ["ai", "status"] as const,
  conversations: ["ai", "conversations"] as const,
  conversation: (conversationId: AiConversationId) =>
    ["ai", "conversations", conversationId] as const,
  proposals: ["ai", "proposals"] as const,
  preferences: ["ai", "preferences"] as const,
}

export const aiStatusQuery = queryOptions({
  queryKey: aiKeys.status,
  queryFn: () => callApi((api) => api.ai.status()),
})

export const aiConversationsQuery = queryOptions({
  queryKey: aiKeys.conversations,
  queryFn: () => callApi((api) => api.ai.conversations()),
})

export const aiConversationQuery = (conversationId: AiConversationId) =>
  queryOptions({
    queryKey: aiKeys.conversation(conversationId),
    queryFn: () => callApi((api) => api.ai.conversation({ params: { conversationId } })),
  })

export const aiProposalsQuery = queryOptions({
  queryKey: aiKeys.proposals,
  queryFn: () => callApi((api) => api.ai.proposals()),
})

export const aiPreferencesQuery = queryOptions({
  queryKey: aiKeys.preferences,
  queryFn: () => callApi((api) => api.ai.preferences()),
})

export interface AiChatStream {
  /** Closes the stream, which interrupts the turn on the server. */
  readonly stop: () => void
}

/**
 * Streams one assistant turn over the shared `/rpc` socket. `onEnd` runs once when the stream
 * finishes on its own; `failed` is true when the RPC stream itself errored. A `stop` call ends the
 * stream silently.
 */
export const streamAiChat = (
  input: AiChatRpcInput,
  handlers: {
    readonly onMessage: (message: AiChatStreamMessage) => void
    readonly onEnd: (failed: boolean) => void
  },
): AiChatStream => {
  const program = Effect.gen(function* () {
    const client = yield* RpcClient.make(AiRpcs)
    yield* client["ai.chat"](input).pipe(
      Stream.runForEach((message) => Effect.sync(() => handlers.onMessage(message))),
    )
  }).pipe(Effect.scoped, Effect.provide(ProtocolLive))

  const fiber = Effect.runFork(
    Effect.exit(program).pipe(
      Effect.flatMap((exit) => Effect.sync(() => handlers.onEnd(!Exit.isSuccess(exit)))),
    ),
  )
  return {
    stop: () => {
      Effect.runFork(Fiber.interrupt(fiber))
    },
  }
}
