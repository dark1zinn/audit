/**
 * Connection test: one short chat call through the provider layer. The outcome is a value, never a
 * failure, so the admin page can show why a provider is unreachable.
 */
import type { ConnectionTestResult } from "@audit/domain/ai/schema"
import { Duration, Effect } from "effect"
import * as LanguageModel from "effect/ai/LanguageModel"
import type { HttpClient } from "effect/http/HttpClient"
import { languageModelLayer, type ProviderConfig } from "./provider.ts"

const PROMPT = "Reply with the single word OK."

export const testConnection = (
  config: ProviderConfig,
): Effect.Effect<ConnectionTestResult, never, HttpClient> =>
  LanguageModel.generateText({ prompt: PROMPT }).pipe(
    Effect.provide(languageModelLayer(config)),
    Effect.timed,
    Effect.map(([duration, response]) => ({
      ok: true,
      message: response.text.trim().slice(0, 200) || "Connected",
      latencyMs: Math.round(Duration.toMillis(duration)),
    })),
    Effect.catch((error) =>
      Effect.succeed({
        ok: false,
        message: error.message,
        latencyMs: 0,
      }),
    ),
  )
