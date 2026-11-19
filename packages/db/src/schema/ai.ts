import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth.ts"
import { createdAt, halfvec, id, timestamptz, updatedAt } from "./columns.ts"
import { entities } from "./core.ts"

const inList = (column: AnyPgColumn, values: ReadonlyArray<string>) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`

export const aiProviderKinds = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "openai_compatible",
] as const

export const aiProviderStatuses = ["untested", "ok", "failed"] as const

/** AI features a workspace can switch on or off. */
export const aiFeatures = [
  "assistant",
  "semantic_search",
  "summaries",
  "doc_upkeep",
  "editor",
  "chat",
  "board",
  "calendar",
] as const

/** Work the AI can do with a feature; recorded per call in `ai_usage`. */
export const aiUsageFeatures = [...aiFeatures, "embedding", "connection_test"] as const

export const aiMessageRoles = ["user", "assistant", "tool"] as const

export const aiProposalStatuses = ["pending", "approved", "rejected", "expired", "failed"] as const

/** Provider accounts. API keys are sealed under the `ai-key` purpose; only the last four
 * characters are kept in clear for display. */
export const aiProviders = pgTable(
  "ai_providers",
  {
    id: id(),
    kind: text("kind").notNull().$type<(typeof aiProviderKinds)[number]>(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull().default(""),
    keyCiphertext: text("key_ciphertext"),
    keyNonce: text("key_nonce"),
    keyLast4: text("key_last4"),
    chatModel: text("chat_model").notNull(),
    embeddingModel: text("embedding_model").notNull().default(""),
    embeddingDimensions: integer("embedding_dimensions").notNull().default(0),
    status: text("status")
      .notNull()
      .default("untested")
      .$type<(typeof aiProviderStatuses)[number]>(),
    lastTestedAt: timestamptz("last_tested_at"),
    lastTestError: text("last_test_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("ai_providers_kind_check", inList(t.kind, aiProviderKinds)),
    check("ai_providers_status_check", inList(t.status, aiProviderStatuses)),
    check(
      "ai_providers_key_check",
      sql`(${t.keyCiphertext} is null) = (${t.keyNonce} is null)
      and (${t.keyCiphertext} is null) = (${t.keyLast4} is null)`,
    ),
    check(
      "ai_providers_dimensions_check",
      sql`${t.embeddingDimensions} >= 0 and ${t.embeddingDimensions} <= 4000`,
    ),
  ],
)

/** Singleton workspace AI configuration. Off until an owner enables it. */
export const aiSettings = pgTable(
  "ai_settings",
  {
    id: integer("id").primaryKey().default(1),
    enabled: boolean("enabled").notNull().default(false),
    defaultProviderId: uuid("default_provider_id").references(() => aiProviders.id, {
      onDelete: "set null",
    }),
    embeddingProviderId: uuid("embedding_provider_id").references(() => aiProviders.id, {
      onDelete: "set null",
    }),
    /** Workspace roles that may use AI at all. */
    allowedRoles: text("allowed_roles")
      .array()
      .notNull()
      .default(sql`'{owner,admin,member}'`),
    /** Per person monthly budget in tokens; null means unlimited. */
    monthlyTokenBudget: integer("monthly_token_budget"),
    features: jsonb("features").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("ai_settings_singleton", sql`${t.id} = 1`),
    check(
      "ai_settings_budget_check",
      sql`${t.monthlyTokenBudget} is null or ${t.monthlyTokenBudget} >= 0`,
    ),
  ],
)

/** Per person AI preferences. `autoApproveTools` lists low-risk tool names that run without a
 * proposal. */
export const aiUserPreferences = pgTable("ai_user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  autoApproveTools: text("auto_approve_tools")
    .array()
    .notNull()
    .default(sql`'{}'`),
  updatedAt: updatedAt(),
})

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    contextEntityId: uuid("context_entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_conversations_user_idx").on(t.userId, t.updatedAt.desc())],
)

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<(typeof aiMessageRoles)[number]>(),
    parts: jsonb("parts").notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    check("ai_messages_role_check", inList(t.role, aiMessageRoles)),
    index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt),
  ],
)

/** Write actions the assistant proposed; a person approves or rejects them before they run. */
export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => aiConversations.id, {
      onDelete: "set null",
    }),
    command: text("command").notNull(),
    input: jsonb("input").notNull().default({}),
    preview: jsonb("preview").notNull().default({}),
    status: text("status")
      .notNull()
      .default("pending")
      .$type<(typeof aiProposalStatuses)[number]>(),
    result: jsonb("result"),
    expiresAt: timestamptz("expires_at").notNull(),
    decidedAt: timestamptz("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("ai_proposals_status_check", inList(t.status, aiProposalStatuses)),
    index("ai_proposals_user_idx").on(t.userId, t.status, t.createdAt.desc()),
  ],
)

/** One row per model call. Tokens feed the monthly per person budget. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    feature: text("feature").notNull().$type<(typeof aiUsageFeatures)[number]>(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("ai_usage_feature_check", inList(t.feature, aiUsageFeatures)),
    index("ai_usage_user_created_idx").on(t.userId, t.createdAt),
    index("ai_usage_created_idx").on(t.createdAt),
  ],
)

/** Chunks of referenceable things. Text is always kept so full-text retrieval works without an
 * embedding model; `vector` and `model` are set once the chunk is embedded. The vector dimension
 * follows the workspace's embedding model; changing the model drops the rows and retypes the
 * column (see `ai/reembed`). */
export const embeddings = pgTable(
  "embeddings",
  {
    id: id(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    chunk: integer("chunk").notNull().default(0),
    text: text("text").notNull().default(""),
    model: text("model"),
    contentHash: text("content_hash").notNull(),
    vector: halfvec("vector", { dimensions: 1536 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("embeddings_entity_chunk_uniq").on(t.entityId, t.chunk),
    index("embeddings_vector_idx").using("hnsw", t.vector.op("halfvec_cosine_ops")),
  ],
)
