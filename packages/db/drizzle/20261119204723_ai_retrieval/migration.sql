DROP INDEX "embeddings_entity_idx";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "ai" jsonb;--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN "text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "generated_by" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ai_digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ai_digest_enabled_by" uuid;--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "vector" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_entity_chunk_uniq" ON "embeddings" ("entity_id","chunk");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_ai_digest_enabled_by_user_id_fkey" FOREIGN KEY ("ai_digest_enabled_by") REFERENCES "user"("id");