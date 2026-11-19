/**
 * The single gate every AI call passes through: enabled, the person's role, the feature's switch,
 * and a configured provider. Each refusal happens before any provider call. The monthly budget is
 * checked by each provider call itself (`checkBudget`), so reading context never fails on it.
 */
import { Authz } from "../authz.ts"
import type { AiFeatureFlags } from "@audit/domain/ai/schema"
import { AiUnavailable } from "@audit/domain/ai/errors"
import { Forbidden } from "@audit/domain/errors"
import type { UserId } from "@audit/domain/ids"
import { Effect } from "effect"
import { readAiSettings } from "./settings.ts"
import { providerConfigFor } from "./providers.ts"

export const loadAiContext = (userId: UserId, feature: keyof AiFeatureFlags) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    const settings = yield* readAiSettings
    if (!settings.enabled) {
      return yield* new Forbidden({ action: "ai.use", message: "AI is turned off" })
    }
    const role = yield* authz.workspaceRole(userId)
    if (role === null || !settings.allowedRoles.includes(role)) {
      return yield* new Forbidden({
        action: "ai.use",
        message: "Your role may not use AI in this workspace",
      })
    }
    if (!settings.features[feature]) {
      return yield* new Forbidden({ action: "ai.use", message: `AI feature ${feature} is off` })
    }
    const providerId = settings.defaultProviderId
    if (providerId === null) {
      return yield* new AiUnavailable({ message: "No AI provider is configured" })
    }
    const config = yield* providerConfigFor(providerId).pipe(
      Effect.catchTag("NotFound", () =>
        Effect.fail(new AiUnavailable({ message: "The configured AI provider no longer exists" })),
      ),
    )
    return { providerId, config, settings }
  })
