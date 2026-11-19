CREATE TABLE "recent_items" (
	"user_id" uuid,
	"entity_id" uuid,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_items_pkey" PRIMARY KEY("user_id","entity_id")
);
--> statement-breakpoint
CREATE INDEX "recent_items_user_viewed_idx" ON "recent_items" ("user_id","viewed_at");--> statement-breakpoint
ALTER TABLE "recent_items" ADD CONSTRAINT "recent_items_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recent_items" ADD CONSTRAINT "recent_items_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;