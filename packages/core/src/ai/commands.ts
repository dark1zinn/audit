/**
 * Workspace AI administration: settings, provider accounts and their connection test. Every
 * command needs `ai.configure` (owners and admins). Trail details never carry a key, only whether
 * one is set.
 */
import { testConnection } from "@audit/ai/connection"
import { guardedHttp, supportsEmbeddings, validateBaseUrl } from "@audit/ai/provider"
import { aiProviders } from "@audit/db/schema"
import { ValidationError, NotFound } from "@audit/domain/errors"
import {
  AiProvider,
  AiProviderInput,
  AiProviderPatch,
  AiSettingsInput,
  ConnectionTestResult,
} from "@audit/domain/ai/schema"
import type { AiProviderKind } from "@audit/domain/ai/schema"
import { AiProviderId } from "@audit/domain/ids"
import { AppConfig } from "@audit/platform/config"
import { Db } from "@audit/platform/database"
import { Jobs } from "@audit/platform/jobs"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { HttpClient } from "effect/http/HttpClient"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { reembedJob } from "./reembed.ts"
import { readAiSettings, writeAiSettings } from "./settings.ts"
import {
  hasEmbeddings,
  loadProvider,
  providerConfigFor,
  sealKey,
  toProviderView,
} from "./providers.ts"
import { record } from "../trail.ts"

const requireConfigure = () =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("ai.configure")
  })

const queueReembed = Effect.gen(function* () {
  const jobs = yield* Jobs
  yield* jobs.enqueue(reembedJob, {}, { singletonKey: "ai.reembed" })
})

/** Fields that must hold together for a provider to work; returns the first problem. */
const checkProvider = (
  kind: AiProviderKind,
  baseUrl: string,
  embeddingModel: string,
  dimensions: number,
) =>
  Effect.gen(function* () {
    if (kind === "openai_compatible" && baseUrl === "") {
      return yield* new ValidationError({ message: "A base URL is required for this provider" })
    }
    if (embeddingModel === "") return
    if (!supportsEmbeddings(kind)) {
      return yield* new ValidationError({ message: "This provider has no embedding endpoint" })
    }
    if (dimensions === 0) {
      return yield* new ValidationError({
        message: "Embedding dimensions are required with an embedding model",
      })
    }
  })

/** Validates a custom endpoint; an empty base URL means the provider's default endpoint. */
const checkBaseUrl = (baseUrl: string) =>
  Effect.gen(function* () {
    if (baseUrl === "") return
    const config = yield* AppConfig
    yield* validateBaseUrl(baseUrl, { allowPrivate: config.aiAllowPrivateBaseUrl })
  })

const ProviderIdInput = Schema.Struct({ providerId: AiProviderId })

export const updateSettings = Command.make("ai.updateSettings", {
  input: AiSettingsInput,
  output: AiSettingsInput,
  authorize: () => requireConfigure(),
  run: (input) =>
    Effect.gen(function* () {
      const previous = yield* readAiSettings
      if (input.defaultProviderId !== null) {
        yield* loadProvider(input.defaultProviderId).pipe(
          Effect.catchTag("NotFound", () =>
            Effect.fail(new ValidationError({ message: "Unknown default AI provider" })),
          ),
        )
      }
      if (input.embeddingProviderId !== null) {
        const row = yield* loadProvider(input.embeddingProviderId).pipe(
          Effect.catchTag("NotFound", () =>
            Effect.fail(new ValidationError({ message: "Unknown embedding AI provider" })),
          ),
        )
        if (!hasEmbeddings(row)) {
          return yield* new ValidationError({
            message: "The embedding provider needs an embedding model",
          })
        }
      }
      yield* writeAiSettings(input)
      if (previous.embeddingProviderId !== input.embeddingProviderId) yield* queueReembed
      yield* record({
        action: "ai.settings_updated",
        details: {
          enabled: input.enabled,
          features: input.features,
          allowedRoles: input.allowedRoles,
          monthlyTokenBudget: input.monthlyTokenBudget,
          conversationRetentionDays: input.conversationRetentionDays,
          defaultProviderId: input.defaultProviderId,
          embeddingProviderId: input.embeddingProviderId,
        },
      })
      return input
    }),
})

export const createProvider = Command.make("ai.createProvider", {
  input: AiProviderInput,
  output: AiProvider,
  authorize: () => requireConfigure(),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const baseUrl = input.baseUrl ?? ""
      const embeddingModel = input.embeddingModel ?? ""
      const dimensions = input.embeddingDimensions ?? 0
      yield* checkProvider(input.kind, baseUrl, embeddingModel, dimensions)
      yield* checkBaseUrl(baseUrl)
      const sealed =
        input.apiKey === undefined || input.apiKey === "" ? null : yield* sealKey(input.apiKey)
      const [row] = yield* db
        .insert(aiProviders)
        .values({
          kind: input.kind,
          name: input.name,
          baseUrl,
          chatModel: input.chatModel,
          embeddingModel,
          embeddingDimensions: dimensions,
          keyCiphertext: sealed?.keyCiphertext ?? null,
          keyNonce: sealed?.keyNonce ?? null,
          keyLast4: sealed?.keyLast4 ?? null,
          status: "untested",
        })
        .returning()
        .pipe(Effect.orDie)
      if (row === undefined) return yield* Effect.die("insert returned no row")
      yield* record({
        action: "ai.provider_created",
        entityId: null,
        details: {
          providerId: row.id,
          kind: row.kind,
          name: row.name,
          chatModel: row.chatModel,
          embeddingModel: row.embeddingModel,
          hasKey: sealed !== null,
        },
      })
      return toProviderView(row)
    }),
})

export const updateProvider = Command.make("ai.updateProvider", {
  input: Schema.Struct({ providerId: AiProviderId, patch: AiProviderPatch }),
  output: AiProvider,
  authorize: () => requireConfigure(),
  run: ({ providerId, patch }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const row = yield* loadProvider(providerId)
      if (patch.baseUrl !== undefined && patch.baseUrl !== row.baseUrl) {
        if (patch.apiKey === undefined || patch.apiKey === "") {
          return yield* new ValidationError({
            message: "Changing the base URL requires a new API key",
          })
        }
        yield* checkBaseUrl(patch.baseUrl)
      }
      const next = {
        name: patch.name ?? row.name,
        baseUrl: patch.baseUrl ?? row.baseUrl,
        chatModel: patch.chatModel ?? row.chatModel,
        embeddingModel: patch.embeddingModel ?? row.embeddingModel,
        embeddingDimensions: patch.embeddingDimensions ?? row.embeddingDimensions,
      }
      yield* checkProvider(row.kind, next.baseUrl, next.embeddingModel, next.embeddingDimensions)
      const key =
        patch.apiKey === undefined
          ? {}
          : patch.apiKey === ""
            ? { keyCiphertext: null, keyNonce: null, keyLast4: null }
            : yield* sealKey(patch.apiKey)
      const connectionChanged =
        patch.baseUrl !== undefined || patch.apiKey !== undefined || patch.chatModel !== undefined
      const [updated] = yield* db
        .update(aiProviders)
        .set({
          ...next,
          ...key,
          ...(connectionChanged
            ? { status: "untested" as const, lastTestedAt: null, lastTestError: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(aiProviders.id, providerId))
        .returning()
        .pipe(Effect.orDie)
      if (updated === undefined)
        return yield* new NotFound({ entity: "ai_provider", id: providerId })
      const settings = yield* readAiSettings
      if (
        settings.embeddingProviderId === providerId &&
        (next.embeddingModel !== row.embeddingModel ||
          next.embeddingDimensions !== row.embeddingDimensions)
      ) {
        yield* queueReembed
      }
      yield* record({
        action: "ai.provider_updated",
        entityId: null,
        details: { providerId, changed: Object.keys(patch) },
      })
      return toProviderView(updated)
    }),
})

export const deleteProvider = Command.make("ai.deleteProvider", {
  input: ProviderIdInput,
  output: Schema.Void,
  authorize: () => requireConfigure(),
  run: ({ providerId }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const row = yield* loadProvider(providerId)
      yield* db.delete(aiProviders).where(eq(aiProviders.id, providerId)).pipe(Effect.orDie)
      yield* record({
        action: "ai.provider_deleted",
        entityId: null,
        details: { providerId, name: row.name },
      })
    }),
})

export const testProvider = Command.make("ai.testProvider", {
  input: ProviderIdInput,
  output: ConnectionTestResult,
  authorize: () => requireConfigure(),
  run: ({ providerId }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const config = yield* providerConfigFor(providerId)
      if (config.baseUrl !== null) yield* checkBaseUrl(config.baseUrl)
      const http = yield* HttpClient
      const app = yield* AppConfig
      const result = yield* testConnection(config).pipe(
        Effect.provideService(
          HttpClient,
          guardedHttp(http, { allowPrivate: app.aiAllowPrivateBaseUrl }),
        ),
      )
      yield* db
        .update(aiProviders)
        .set({
          status: result.ok ? "ok" : "failed",
          lastTestedAt: new Date(),
          lastTestError: result.ok ? null : result.message,
          updatedAt: new Date(),
        })
        .where(eq(aiProviders.id, providerId))
        .pipe(Effect.orDie)
      yield* record({
        action: "ai.provider_tested",
        entityId: null,
        details: { providerId, ok: result.ok },
      })
      return result
    }),
})
