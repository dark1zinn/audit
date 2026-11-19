CREATE TABLE "doc_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"doc_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" bytea NOT NULL,
	"content" jsonb NOT NULL,
	"label" text,
	"kind" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_versions_kind_check" CHECK ("kind" in ('auto', 'named', 'restore'))
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY,
	"parent_doc_id" uuid,
	"project_id" uuid,
	"position" text NOT NULL,
	"icon" text,
	"ydoc" bytea,
	"content" jsonb,
	"content_text" text DEFAULT '' NOT NULL,
	"last_edited_by" uuid,
	"last_edited_at" timestamp with time zone,
	"review_every_days" integer,
	"owner_user_id" uuid,
	"verified_at" timestamp with time zone,
	"review_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_review_days_check" CHECK ("review_every_days" is null or "review_every_days" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "doc_versions_doc_version_uq" ON "doc_versions" ("doc_id","version");--> statement-breakpoint
CREATE INDEX "docs_parent_idx" ON "docs" ("parent_doc_id","position");--> statement-breakpoint
CREATE INDEX "docs_project_idx" ON "docs" ("project_id");--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_doc_id_docs_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "docs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_parent_doc_id_docs_id_fkey" FOREIGN KEY ("parent_doc_id") REFERENCES "docs"("id");--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_last_edited_by_user_id_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT "entities_type_check", ADD CONSTRAINT "entities_type_check" CHECK ("type" in ('user', 'team', 'project', 'board', 'task', 'doc', 'comment', 'channel', 'message', 'calendar', 'event', 'file', 'space'));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check", ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('task_due_soon', 'task_overdue', 'task_assigned', 'mention', 'doc_review_due'));