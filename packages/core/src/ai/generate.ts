/**
 * One structured model call behind the AI gate, for background work (doc upkeep, digests). The
 * gate runs first, so a refusal happens before any provider call. Usage is recorded per call.
 */
import type { AiFeatureFlags } from "@audit/domain/ai/schema"
import { AiUnavailable } from "@audit/domain/ai/errors"
import type { UserId } from "@audit/domain/ids"
import * as LanguageModel from "effect/ai/LanguageModel"
import { Effect, Schema } from "effect"
import { loadAiContext } from "./guard.ts"
import { AiModels } from "./models.ts"
import { checkBudget, recordUsage } from "./usage.ts"

export const generateStructured = <A, I extends Record<string, unknown>>(
  userId: UserId,
  feature: keyof AiFeatureFlags,
  prompt: string,
  schema: Schema.Codec<A, I>,
) =>
  Effect.gen(function* () {
    const loaded = yield* loadAiContext(userId, feature)
    yield* checkBudget(userId, loaded.settings)
    const models = yield* AiModels
    const response = yield* LanguageModel.generateObject({
      prompt,
      schema,
      objectName: feature,
    }).pipe(
      Effect.mapError((error) => new AiUnavailable({ message: error.message })),
      Effect.provide(models.language(loaded.config)),
    )
    yield* recordUsage({
      userId,
      providerId: loaded.providerId,
      feature,
      model: loaded.config.chatModel,
      inputTokens: response.usage.inputTokens.total ?? 0,
      outputTokens: response.usage.outputTokens.total ?? 0,
    })
    return response.value
  })
