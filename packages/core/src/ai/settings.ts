/** The workspace's AI configuration: one singleton row, read with safe defaults when absent. */
import { aiSettings } from "@audit/db/schema"
import type { AiFeatureFlags, AiSettings, AiSettingsInput } from "@audit/domain/ai/schema"
import type { AiProviderId } from "@audit/domain/ids"
import type { WorkspaceRole } from "@audit/domain/roles"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Effect } from "effect"

export const defaultFeatures: AiFeatureFlags = {
  assistant: false,
  semantic_search: false,
  summaries: false,
  doc_upkeep: false,
  editor: false,
  chat: false,
  board: false,
  calendar: false,
}

/** Days an AI conversation is kept after its last activity, unless the workspace changes it. */
export const DEFAULT_CONVERSATION_RETENTION_DAYS = 90

export const defaultAiSettings: AiSettings = {
  enabled: false,
  defaultProviderId: null,
  embeddingProviderId: null,
  allowedRoles: ["owner", "admin", "member"],
  monthlyTokenBudget: null,
  features: defaultFeatures,
  conversationRetentionDays: DEFAULT_CONVERSATION_RETENTION_DAYS,
}

/** Reads the singleton; a workspace that never saved AI settings gets `defaultAiSettings`. */
export const readAiSettings = Effect.gen(function* () {
  const db = yield* Db
  const [row] = yield* db.select().from(aiSettings).where(eq(aiSettings.id, 1)).pipe(Effect.orDie)
  if (row === undefined) return defaultAiSettings
  return {
    enabled: row.enabled,
    defaultProviderId: row.defaultProviderId as AiProviderId | null,
    embeddingProviderId: row.embeddingProviderId as AiProviderId | null,
    allowedRoles: row.allowedRoles as Array<WorkspaceRole>,
    monthlyTokenBudget: row.monthlyTokenBudget,
    conversationRetentionDays: row.conversationRetentionDays,
    features: { ...defaultFeatures, ...(row.features as Partial<AiFeatureFlags>) },
  } satisfies AiSettings
})

/** Upserts the singleton. Callers check the capability and validate the provider references. */
export const writeAiSettings = (input: AiSettingsInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const values = {
      enabled: input.enabled,
      defaultProviderId: input.defaultProviderId,
      embeddingProviderId: input.embeddingProviderId,
      allowedRoles: [...input.allowedRoles],
      monthlyTokenBudget: input.monthlyTokenBudget,
      conversationRetentionDays: input.conversationRetentionDays,
      features: { ...input.features },
    }
    yield* db
      .insert(aiSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({
        target: aiSettings.id,
        set: { ...values, updatedAt: new Date() },
      })
      .pipe(Effect.orDie)
  })
