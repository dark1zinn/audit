/**
 * Deterministic stand-ins for the chat and embedding models. Tests provide these instead of a
 * provider layer, so no request leaves the process; the reply function is the test's probe for
 * how often and with what prompt the model was called.
 */
import { Effect, Layer, Stream } from "effect"
import * as EmbeddingModel from "effect/ai/EmbeddingModel"
import * as LanguageModel from "effect/ai/LanguageModel"
import type * as Response from "effect/ai/Response"

export interface FakeReply {
  readonly text: string
  readonly inputTokens?: number
  readonly outputTokens?: number
}

const finishPart = (answer: FakeReply) => ({
  type: "finish" as const,
  reason: "stop" as const,
  usage: {
    inputTokens: { total: answer.inputTokens ?? 0 },
    outputTokens: { total: answer.outputTokens ?? 0 },
  },
})

/** A chat model answering each call with `reply(serialisedPrompt)`. */
export const fakeLanguageModel = (
  reply: (prompt: string) => FakeReply,
): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) =>
        Effect.sync((): Array<Response.PartEncoded> => {
          const answer = reply(JSON.stringify(options.prompt))
          return [{ type: "text", text: answer.text }, finishPart(answer)]
        }),
      streamText: (options) =>
        Stream.fromEffect(
          Effect.sync((): ReadonlyArray<Response.StreamPartEncoded> => {
            const answer = reply(JSON.stringify(options.prompt))
            return [
              { type: "text-start", id: "fake" },
              { type: "text-delta", id: "fake", delta: answer.text },
              { type: "text-end", id: "fake" },
              finishPart(answer),
            ]
          }),
        ).pipe(Stream.flatMap((parts) => Stream.fromIterable(parts))),
    }),
  )

/** Unit vector derived from the SHA-256 of the text: same text, same vector, every run. */
export const fakeVector = (text: string, dimensions: number): ReadonlyArray<number> => {
  const digest = new Bun.CryptoHasher("sha256").update(text).digest()
  const raw = Array.from({ length: dimensions }, (_, index) => {
    const byte = digest[index % digest.length] ?? 0
    return byte / 255 - 0.5 + index / (dimensions * 1000)
  })
  const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1
  return raw.map((value) => value / norm)
}

/** An embedding model with deterministic vectors of the given dimensions. */
export const fakeEmbeddingModel = (options: {
  readonly dimensions: number
}): Layer.Layer<EmbeddingModel.EmbeddingModel> =>
  Layer.effect(
    EmbeddingModel.EmbeddingModel,
    EmbeddingModel.make({
      embedMany: (request) =>
        Effect.sync(() => ({
          results: request.inputs.map((text) => [...fakeVector(text, options.dimensions)]),
          usage: { inputTokens: request.inputs.reduce((sum, text) => sum + text.length, 0) },
        })),
    }),
  )
