CREATE TABLE "channel_members" (
	"channel_id" uuid,
	"user_id" uuid,
	"role" text DEFAULT 'member' NOT NULL,
	"last_read_message_id" uuid,
	"notify_level" text DEFAULT 'mentions' NOT NULL,
	"muted_until" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_members_pkey" PRIMARY KEY("channel_id","user_id"),
	CONSTRAINT "channel_members_role_check" CHECK ("role" in ('member', 'manager')),
	CONSTRAINT "channel_members_notify_check" CHECK ("notify_level" in ('all', 'mentions', 'none'))
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY,
	"kind" text NOT NULL,
	"project_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"dm_key" text UNIQUE,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	CONSTRAINT "channels_kind_check" CHECK ("kind" in ('public', 'private', 'dm', 'group_dm')),
	CONSTRAINT "channels_dm_key_check" CHECK (("kind" in ('dm', 'group_dm')) = ("dm_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY,
	"channel_id" uuid NOT NULL,
	"thread_root_id" uuid,
	"author_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"last_reply_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"channel_id" uuid,
	"message_id" uuid,
	"pinned_by" uuid NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pins_pkey" PRIMARY KEY("channel_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"message_id" uuid,
	"user_id" uuid,
	"emoji" text,
	CONSTRAINT "reactions_pkey" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "saved_messages" (
	"user_id" uuid,
	"message_id" uuid,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_messages_pkey" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "thread_followers" (
	"root_id" uuid,
	"user_id" uuid,
	"last_read_id" uuid,
	CONSTRAINT "thread_followers_pkey" PRIMARY KEY("root_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "channel_members_user_idx" ON "channel_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_name_uq" ON "channels" ("name") WHERE "kind" in ('public', 'private');--> statement-breakpoint
CREATE INDEX "channels_project_idx" ON "channels" ("project_id");--> statement-breakpoint
CREATE INDEX "messages_channel_idx" ON "messages" ("channel_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" ("thread_root_id","id");--> statement-breakpoint
CREATE INDEX "thread_followers_user_idx" ON "thread_followers" ("user_id");--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_last_read_message_id_entities_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "entities"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_root_id_messages_id_fkey" FOREIGN KEY ("thread_root_id") REFERENCES "messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_channel_id_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_message_id_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_pinned_by_user_id_fkey" FOREIGN KEY ("pinned_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_messages" ADD CONSTRAINT "saved_messages_message_id_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "thread_followers" ADD CONSTRAINT "thread_followers_root_id_messages_id_fkey" FOREIGN KEY ("root_id") REFERENCES "messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "thread_followers" ADD CONSTRAINT "thread_followers_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "thread_followers" ADD CONSTRAINT "thread_followers_last_read_id_messages_id_fkey" FOREIGN KEY ("last_read_id") REFERENCES "messages"("id") ON DELETE SET NULL;