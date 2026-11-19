CREATE TABLE "board_columns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"position" text NOT NULL,
	"wip_limit" integer,
	CONSTRAINT "board_columns_category_check" CHECK ("category" in ('backlog', 'todo', 'in_progress', 'done', 'canceled')),
	CONSTRAINT "board_columns_wip_check" CHECK ("wip_limit" is null or "wip_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY,
	"target_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"anchor" jsonb,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"parent_comment_id" uuid,
	"resolved_at" timestamp with time zone,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	CONSTRAINT "labels_color_check" CHECK ("color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"group_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('task_due_soon', 'task_overdue', 'task_assigned', 'mention'))
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"filter" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"task_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignees_pkey" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_labels" (
	"task_id" uuid,
	"label_id" uuid,
	CONSTRAINT "task_labels_pkey" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY,
	"board_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"position" text NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"estimate" integer,
	"description" jsonb,
	"completed_at" timestamp with time zone,
	"due_notified_at" timestamp with time zone,
	"overdue_notified_at" timestamp with time zone,
	CONSTRAINT "tasks_priority_check" CHECK ("priority" in ('none', 'low', 'medium', 'high', 'urgent')),
	CONSTRAINT "tasks_estimate_check" CHECK ("estimate" is null or "estimate" between 0 and 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "board_columns_position_uniq" ON "board_columns" ("board_id","position");--> statement-breakpoint
CREATE INDEX "boards_project_idx" ON "boards" ("project_id","position");--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" ("target_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_project_name_uniq" ON "labels" ("project_id","name");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" ("user_id","archived_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_group_idx" ON "notifications" ("user_id","group_key");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" ("entity_id");--> statement-breakpoint
CREATE INDEX "saved_filters_user_idx" ON "saved_filters" ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" ("user_id");--> statement-breakpoint
CREATE INDEX "task_labels_label_idx" ON "task_labels" ("label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_number_uniq" ON "tasks" ("project_id","number");--> statement-breakpoint
CREATE INDEX "tasks_column_position_idx" ON "tasks" ("column_id","position");--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" ("board_id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" ("due_at");--> statement-breakpoint
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_board_id_boards_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_target_id_entities_id_fkey" FOREIGN KEY ("target_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id");--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_task_id_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_label_id_labels_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_id_boards_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_column_id_board_columns_id_fkey" FOREIGN KEY ("column_id") REFERENCES "board_columns"("id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");