/**
 * Provider rows. API keys are sealed under the `ai-key` purpose and never leave this module in
 * the clear: views carry the last four characters only.
 */
import { type ProviderConfig, supportsEmbeddings } from "@audit/ai/provider"
import { aiProviders } from "@audit/db/schema"
import { NotFound } from "@audit/domain/errors"
import type { AiProvider } from "@audit/domain/ai/schema"
import type { AiProviderId } from "@audit/domain/ids"
import { Secrets } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Effect, Redacted } from "effect"

export const KEY_PURPOSE = "ai-key"

export type ProviderRow = typeof aiProviders.$inferSelect

export const toProviderView = (row: ProviderRow): AiProvider => ({
  id: row.id as AiProviderId,
  kind: row.kind,
  name: row.name,
  baseUrl: row.baseUrl,
  chatModel: row.chatModel,
  embeddingModel: row.embeddingModel,
  embeddingDimensions: row.embeddingDimensions,
  hasKey: row.keyCiphertext !== null,
  keyLast4: row.keyLast4,
  status: row.status,
  lastTestedAt: row.lastTestedAt,
  lastTestError: row.lastTestError,
})

export const loadProvider = (providerId: AiProviderId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, providerId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "ai_provider", id: providerId })
    return row
  })

/** Seals a new key. The last four characters are the only part kept in clear. */
export const sealKey = (apiKey: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const sealed = yield* secrets.seal(KEY_PURPOSE, apiKey)
    return {
      keyCiphertext: sealed.ciphertext,
      keyNonce: sealed.nonce,
      keyLast4: apiKey.slice(-4),
    }
  })

/** The provider layer's config for a stored provider, with its key opened for the call. */
export const providerConfigFor = (providerId: AiProviderId) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const row = yield* loadProvider(providerId)
    const apiKey =
      row.keyCiphertext !== null && row.keyNonce !== null
        ? yield* secrets.open(KEY_PURPOSE, { ciphertext: row.keyCiphertext, nonce: row.keyNonce })
        : null
    return configOf(row, apiKey)
  })

/** Builds the provider config from a row and an already-opened key. */
export const configOf = (row: ProviderRow, apiKey: Redacted.Redacted | null): ProviderConfig => ({
  kind: row.kind,
  apiKey,
  baseUrl: row.baseUrl,
  chatModel: row.chatModel,
  embeddingModel: row.embeddingModel === "" ? null : row.embeddingModel,
  embeddingDimensions: row.embeddingDimensions === 0 ? null : row.embeddingDimensions,
})

/** Whether a stored provider can produce embeddings (kind supports it and a model is set). */
export const hasEmbeddings = (row: ProviderRow): boolean =>
  supportsEmbeddings(row.kind) && row.embeddingModel !== "" && row.embeddingDimensions > 0
