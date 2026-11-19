/**
 * Embedding for semantic search. Retrieval calls `currentEmbeddingModel` first and falls back to
 * full-text when it is null, so nothing here runs unless AI and semantic search are both on.
 */
import { AiUnavailable } from "@audit/domain/ai/errors"
import type { AiProviderId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import type { Secrets } from "@audit/platform/crypto"
import { Effect } from "effect"
import * as EmbeddingModel from "effect/ai/EmbeddingModel"
import { AiModels } from "./models.ts"
import { readAiSettings } from "./settings.ts"
import { providerConfigFor } from "./providers.ts"
import { recordUsage } from "./usage.ts"

export interface EmbeddingBatch {
  readonly model: string
  readonly dimensions: number
  readonly vectors: ReadonlyArray<ReadonlyArray<number>>
}

/**
 * The embedding model in use, or `null` when semantic search is off or no embedding provider is
 * configured. Makes no provider call.
 */
export const currentEmbeddingModel = Effect.gen(function* () {
  const settings = yield* readAiSettings
  if (!settings.enabled || !settings.features.semantic_search) return null
  const providerId = settings.embeddingProviderId
  if (providerId === null) return null
  const config = yield* providerConfigFor(providerId).pipe(
    Effect.catchTag("NotFound", () => Effect.succeed(null)),
  )
  if (config === null || config.embeddingModel === null || config.embeddingDimensions === null) {
    return null
  }
  return { model: config.embeddingModel, dimensions: config.embeddingDimensions }
})

/**
 * Embeds texts with the configured embedding provider. Batches are system work (no person), so
 * usage is recorded without a user.
 */
export const embedTexts = (
  texts: ReadonlyArray<string>,
): Effect.Effect<EmbeddingBatch, AiUnavailable, Db | Secrets | AiModels> =>
  Effect.gen(function* () {
    const settings = yield* readAiSettings
    if (!settings.enabled || !settings.features.semantic_search) {
      return yield* new AiUnavailable({ message: "Semantic search is off" })
    }
    const providerId = settings.embeddingProviderId
    if (providerId === null) {
      return yield* new AiUnavailable({ message: "No embedding provider is configured" })
    }
    const config = yield* providerConfigFor(providerId).pipe(
      Effect.catchTag("NotFound", () =>
        Effect.fail(new AiUnavailable({ message: "The embedding provider no longer exists" })),
      ),
    )
    if (config.embeddingModel === null || config.embeddingDimensions === null) {
      return yield* new AiUnavailable({ message: "The embedding provider has no model" })
    }
    const models = yield* AiModels
    const response = yield* Effect.gen(function* () {
      const model = yield* EmbeddingModel.EmbeddingModel
      return yield* model.embedMany(texts)
    }).pipe(
      Effect.provide(models.embedding(config)),
      Effect.mapError(() => new AiUnavailable({ message: "The embedding request failed" })),
    )
    yield* recordUsage({
      userId: null,
      providerId: providerId as AiProviderId,
      feature: "embedding",
      model: config.embeddingModel,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: 0,
    })
    return {
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
      vectors: response.embeddings.map((item) => item.vector),
    }
  })
