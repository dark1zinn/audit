/**
 * Streaming assistant RPC. Closing the client stream interrupts the turn, which stops further
 * model calls (see `chatTurn` in core).
 */
import { RequestMeta } from "@audit/core/request"
import { chatTurn } from "@audit/core/ai/assistant"
import { AiRpcs } from "@audit/domain/ai/rpc"
import { Effect, Stream } from "effect"

export const AiRpcLive = AiRpcs.toLayer(
  Effect.succeed({
    "ai.chat": (input) => chatTurn(input).pipe(Stream.provideService(RequestMeta, {})),
  }),
)
