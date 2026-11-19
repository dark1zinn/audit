CREATE TABLE "access_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"resource_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid,
	"principal_role" text,
	"role" text NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_entries_role_check" CHECK ("role" in ('viewer', 'commenter', 'editor', 'manager')),
	CONSTRAINT "access_entries_principal_check" CHECK (("principal_type" = 'role') = ("principal_role" is not null and "principal_id" is null))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_access" (
	"container_id" uuid,
	"user_id" uuid,
	"role" text NOT NULL,
	CONSTRAINT "container_access_pkey" PRIMARY KEY("user_id","container_id")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"type" text NOT NULL,
	"project_id" uuid,
	"parent_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"search" tsvector,
	CONSTRAINT "entities_type_check" CHECK ("type" in ('user', 'team', 'project', 'board', 'task', 'doc', 'comment', 'channel', 'message', 'calendar', 'event', 'file'))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"scan_status" text DEFAULT 'skipped' NOT NULL,
	"unreferenced_at" timestamp with time zone,
	CONSTRAINT "files_scan_status_check" CHECK ("scan_status" in ('skipped', 'pending', 'clean', 'infected'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text,
	"actor_id" uuid,
	"command" text NOT NULL,
	"result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY("actor_id","key")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"token_hash" text NOT NULL UNIQUE,
	"email" text,
	"role" text NOT NULL,
	"team_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"project_grants" jsonb DEFAULT '[]' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_role_check" CHECK ("role" in ('member', 'guest')),
	CONSTRAINT "invites_uses_check" CHECK ("use_count" <= "max_uses" and "max_uses" >= 1)
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"lead_user_id" uuid,
	"visibility" text NOT NULL,
	"member_role" text DEFAULT 'editor' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"task_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "projects_key_check" CHECK ("key" ~ '^[A-Z]{2,6}$'),
	CONSTRAINT "projects_visibility_check" CHECK ("visibility" in ('workspace', 'restricted')),
	CONSTRAINT "projects_member_role_check" CHECK ("member_role" in ('viewer', 'commenter', 'editor', 'manager')),
	CONSTRAINT "projects_status_check" CHECK ("status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "references" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"snippet" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "references_kind_check" CHECK ("kind" in ('mention', 'link', 'embed', 'blocks', 'relates', 'duplicates', 'scheduled_for'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid,
	"user_id" uuid,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_pkey" PRIMARY KEY("team_id","user_id"),
	CONSTRAINT "team_members_role_check" CHECK ("role" in ('member', 'lead'))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"kind" text NOT NULL,
	"project_id" uuid,
	"project_role" text DEFAULT 'editor' NOT NULL,
	CONSTRAINT "teams_kind_check" CHECK ("kind" in ('workspace', 'project')),
	CONSTRAINT "teams_project_role_check" CHECK ("project_role" in ('viewer', 'commenter', 'editor', 'manager')),
	CONSTRAINT "teams_project_scope_check" CHECK (("kind" = 'project') = ("project_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "trail_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"seq" bigint DEFAULT 0 NOT NULL UNIQUE,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"on_behalf_of" uuid,
	"action" text NOT NULL,
	"entity_id" uuid,
	"entity_type" text,
	"project_id" uuid,
	"diff" jsonb,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"prev_hash" text,
	"hash" text DEFAULT '' NOT NULL,
	CONSTRAINT "trail_events_actor_type_check" CHECK ("actor_type" in ('user', 'ai', 'system'))
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY,
	"display_name" text NOT NULL,
	"title" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text,
	"avatar_file_id" uuid,
	"ical_token_hash" text UNIQUE,
	"last_seen_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchers" (
	"entity_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchers_pkey" PRIMARY KEY("entity_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" smallint PRIMARY KEY DEFAULT 1,
	"name" text NOT NULL,
	"logo_file_id" uuid,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"signup_policy" jsonb DEFAULT '{"mode":"closed","domains":[]}' NOT NULL,
	"search_config" text DEFAULT 'english' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_singleton" CHECK ("id" = 1),
	CONSTRAINT "workspace_search_config_check" CHECK ("search_config" in ('english', 'portuguese', 'spanish'))
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"user_id" uuid PRIMARY KEY,
	"role" text NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_role_check" CHECK ("role" in ('owner', 'admin', 'member', 'guest'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "access_entries_principal_uq" ON "access_entries" ("resource_id","principal_type","principal_id") WHERE "principal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "access_entries_role_uq" ON "access_entries" ("resource_id","principal_role") WHERE "principal_role" is not null;--> statement-breakpoint
CREATE INDEX "access_entries_principal_idx" ON "access_entries" ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "container_access_container_idx" ON "container_access" ("container_id");--> statement-breakpoint
CREATE INDEX "entities_search_gin" ON "entities" USING gin ("search");--> statement-breakpoint
CREATE INDEX "entities_title_trgm" ON "entities" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "entities_project_idx" ON "entities" ("project_id","type");--> statement-breakpoint
CREATE INDEX "entities_parent_idx" ON "entities" ("parent_id");--> statement-breakpoint
CREATE INDEX "files_sha256_idx" ON "files" ("sha256");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" ("expires_at");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_id_idx" ON "passkey" ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "references_source_target_kind_uq" ON "references" ("source_id","target_id","kind");--> statement-breakpoint
CREATE INDEX "references_target_kind_idx" ON "references" ("target_id","kind");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" ("user_id");--> statement-breakpoint
CREATE INDEX "trail_events_entity_idx" ON "trail_events" ("entity_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trail_events_at_idx" ON "trail_events" ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trail_events_actor_idx" ON "trail_events" ("actor_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "two_factor_secret_idx" ON "two_factor" ("secret");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "watchers_user_idx" ON "watchers" ("user_id");--> statement-breakpoint
ALTER TABLE "access_entries" ADD CONSTRAINT "access_entries_resource_id_entities_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "access_entries" ADD CONSTRAINT "access_entries_granted_by_user_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "container_access" ADD CONSTRAINT "container_access_container_id_entities_id_fkey" FOREIGN KEY ("container_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "container_access" ADD CONSTRAINT "container_access_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_project_id_entities_id_fkey" FOREIGN KEY ("project_id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_id_entities_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_user_id_user_id_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_source_id_entities_id_fkey" FOREIGN KEY ("source_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_target_id_entities_id_fkey" FOREIGN KEY ("target_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "watchers" ADD CONSTRAINT "watchers_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "watchers" ADD CONSTRAINT "watchers_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_user_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "user"("id");