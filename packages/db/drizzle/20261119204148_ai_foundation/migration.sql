CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"context_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_role_check" CHECK ("role" in ('user', 'assistant', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"command" text NOT NULL,
	"input" jsonb DEFAULT '{}' NOT NULL,
	"preview" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposals_status_check" CHECK ("status" in ('pending', 'approved', 'rejected', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"key_ciphertext" text,
	"key_nonce" text,
	"key_last4" text,
	"chat_model" text NOT NULL,
	"embedding_model" text DEFAULT '' NOT NULL,
	"embedding_dimensions" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_kind_check" CHECK ("kind" in ('openai', 'anthropic', 'google', 'openrouter', 'openai_compatible')),
	CONSTRAINT "ai_providers_status_check" CHECK ("status" in ('untested', 'ok', 'failed')),
	CONSTRAINT "ai_providers_key_check" CHECK (("key_ciphertext" is null) = ("key_nonce" is null)
      and ("key_ciphertext" is null) = ("key_last4" is null)),
	CONSTRAINT "ai_providers_dimensions_check" CHECK ("embedding_dimensions" >= 0 and "embedding_dimensions" <= 4000)
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_provider_id" uuid,
	"embedding_provider_id" uuid,
	"allowed_roles" text[] DEFAULT '{owner,admin,member}'::text[] NOT NULL,
	"monthly_token_budget" integer,
	"features" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_singleton" CHECK ("id" = 1),
	CONSTRAINT "ai_settings_budget_check" CHECK ("monthly_token_budget" is null or "monthly_token_budget" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid,
	"provider_id" uuid,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_feature_check" CHECK ("feature" in ('assistant', 'semantic_search', 'summaries', 'doc_upkeep', 'editor', 'chat', 'board', 'calendar', 'embedding', 'connection_test'))
);
--> statement-breakpoint
CREATE TABLE "ai_user_preferences" (
	"user_id" uuid PRIMARY KEY,
	"auto_approve_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"chunk" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"vector" halfvec(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_proposals_user_idx" ON "ai_proposals" ("user_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" ("created_at");--> statement-breakpoint
CREATE INDEX "embeddings_entity_idx" ON "embeddings" ("entity_id","chunk");--> statement-breakpoint
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("vector" halfvec_cosine_ops);--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_context_entity_id_entities_id_fkey" FOREIGN KEY ("context_entity_id") REFERENCES "entities"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_conversation_id_ai_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_default_provider_id_ai_providers_id_fkey" FOREIGN KEY ("default_provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_embedding_provider_id_ai_providers_id_fkey" FOREIGN KEY ("embedding_provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_provider_id_ai_providers_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ai_user_preferences" ADD CONSTRAINT "ai_user_preferences_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;