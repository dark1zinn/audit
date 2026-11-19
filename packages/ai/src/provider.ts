/**
 * Provider layers: one `LanguageModel` and one `EmbeddingModel` per configured provider. Every
 * kind is reached over HTTP through the `HttpClient` the caller provides, so tests inject a fake
 * at that boundary. Google speaks the OpenAI-compatible protocol at its Gemini endpoint.
 */
import { AiUnavailable } from "@audit/domain/ai/errors"
import type { AiProviderKind } from "@audit/domain/ai/schema"
import * as AnthropicClient from "@effect/ai-anthropic/AnthropicClient"
import * as AnthropicLanguageModel from "@effect/ai-anthropic/AnthropicLanguageModel"
import * as CompatClient from "@effect/ai-openai-compat/OpenAiClient"
import * as CompatEmbeddingModel from "@effect/ai-openai-compat/OpenAiEmbeddingModel"
import * as CompatLanguageModel from "@effect/ai-openai-compat/OpenAiLanguageModel"
import * as OpenAiClient from "@effect/ai-openai/OpenAiClient"
import * as OpenAiEmbeddingModel from "@effect/ai-openai/OpenAiEmbeddingModel"
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel"
import * as OpenRouterClient from "@effect/ai-openrouter/OpenRouterClient"
import * as OpenRouterLanguageModel from "@effect/ai-openrouter/OpenRouterLanguageModel"
import { Effect, Layer, type Redacted } from "effect"
import * as EmbeddingModel from "effect/ai/EmbeddingModel"
import * as LanguageModel from "effect/ai/LanguageModel"
import type { HttpClient } from "effect/http/HttpClient"

/** What a provider layer needs; the decrypted key only lives here, never in the domain view. */
export interface ProviderConfig {
  readonly kind: AiProviderKind
  readonly apiKey: Redacted.Redacted<string> | null
  readonly baseUrl: string | null
  readonly chatModel: string
  readonly embeddingModel: string | null
  readonly embeddingDimensions: number | null
}

export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

const OPENROUTER_REFERRER = "https://github.com/audit"

/** Kinds whose embedding endpoint the layers below can call. */
export const supportsEmbeddings = (kind: AiProviderKind): boolean =>
  kind === "openai" || kind === "google" || kind === "openai_compatible"

const apiKeyOption = (config: ProviderConfig) =>
  config.apiKey === null ? {} : { apiKey: config.apiKey }

const baseUrlOption = (config: ProviderConfig) =>
  config.baseUrl === null ? {} : { apiUrl: config.baseUrl }

/** OpenAI-compatible client for Google (fixed Gemini endpoint) and custom compatible servers. */
const compatClient = (config: ProviderConfig) =>
  CompatClient.layer({
    ...apiKeyOption(config),
    apiUrl: config.kind === "google" ? GOOGLE_BASE_URL : (config.baseUrl ?? undefined),
  })

const failLanguageModel = (message: string) =>
  Layer.effect(LanguageModel.LanguageModel, Effect.fail(new AiUnavailable({ message })))

const failEmbeddingModel = (message: string) =>
  Layer.effect(EmbeddingModel.EmbeddingModel, Effect.fail(new AiUnavailable({ message })))

export const languageModelLayer = (
  config: ProviderConfig,
): Layer.Layer<LanguageModel.LanguageModel, AiUnavailable, HttpClient> => {
  switch (config.kind) {
    case "openai":
      return OpenAiLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(OpenAiClient.layer({ ...apiKeyOption(config), ...baseUrlOption(config) })),
      )
    case "anthropic":
      return AnthropicLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(AnthropicClient.layer({ ...apiKeyOption(config), ...baseUrlOption(config) })),
      )
    case "openrouter":
      return OpenRouterLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(
          OpenRouterClient.layer({
            ...apiKeyOption(config),
            ...baseUrlOption(config),
            siteReferrer: OPENROUTER_REFERRER,
          }),
        ),
      )
    case "google":
    case "openai_compatible":
      if (config.kind === "openai_compatible" && config.baseUrl === null)
        return failLanguageModel("OpenAI-compatible providers need a base URL")
      return CompatLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(compatClient(config)),
      )
  }
}

/** The embedding model for a provider; fails `AiUnavailable` when the kind has none. */
export const embeddingModelLayer = (
  config: ProviderConfig,
): Layer.Layer<EmbeddingModel.EmbeddingModel, AiUnavailable, HttpClient> => {
  if (config.embeddingModel === null || config.embeddingDimensions === null)
    return failEmbeddingModel("No embedding model is configured")
  const model = config.embeddingModel
  const dimensions = config.embeddingDimensions
  switch (config.kind) {
    case "openai":
      return OpenAiEmbeddingModel.layer({ model, config: { dimensions } }).pipe(
        Layer.provide(OpenAiClient.layer({ ...apiKeyOption(config), ...baseUrlOption(config) })),
      )
    case "google":
    case "openai_compatible":
      if (config.kind === "openai_compatible" && config.baseUrl === null)
        return failEmbeddingModel("OpenAI-compatible providers need a base URL")
      return CompatEmbeddingModel.layer({ model, config: { dimensions } }).pipe(
        Layer.provide(compatClient(config)),
      )
    case "anthropic":
    case "openrouter":
      return failEmbeddingModel(`${config.kind} has no embedding endpoint`)
  }
}
