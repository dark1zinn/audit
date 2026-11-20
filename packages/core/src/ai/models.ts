/**
 * The chat and embedding models a feature talks to. Live, these build the provider layers over the
 * server's `HttpClient`; tests replace the service with deterministic fakes so no request leaves
 * the process.
 */
import type { ProviderConfig } from "@audit/ai/provider"
import { embeddingModelLayer, guardedHttp, languageModelLayer } from "@audit/ai/provider"
import type { AiUnavailable } from "@audit/domain/ai/errors"
import { Context, Effect, Layer } from "effect"
import type * as EmbeddingModel from "effect/ai/EmbeddingModel"
import type * as LanguageModel from "effect/ai/LanguageModel"
import { HttpClient } from "effect/http/HttpClient"
import { AppConfig } from "@audit/platform/config"

export interface AiModelsShape {
  readonly language: (
    config: ProviderConfig,
  ) => Layer.Layer<LanguageModel.LanguageModel, AiUnavailable>
  readonly embedding: (
    config: ProviderConfig,
  ) => Layer.Layer<EmbeddingModel.EmbeddingModel, AiUnavailable>
}

export class AiModels extends Context.Service<AiModels, AiModelsShape>()("@audit/core/AiModels") {}

/**
 * Provider layers over the ambient `HttpClient`, with every request checked against the endpoint
 * policy (see `guardedHttp`). The server provides the client; tests replace the service.
 */
export const liveAiModels = Layer.effect(
  AiModels,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const http = yield* HttpClient
    const withHttp = Layer.provide(
      Layer.succeed(HttpClient, guardedHttp(http, { allowPrivate: config.aiAllowPrivateBaseUrl })),
    )
    return AiModels.of({
      language: (provider) => languageModelLayer(provider).pipe(withHttp),
      embedding: (provider) => embeddingModelLayer(provider).pipe(withHttp),
    })
  }),
)
