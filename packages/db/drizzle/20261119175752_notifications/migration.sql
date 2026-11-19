CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY,
	"project_id" uuid,
	"owner_user_id" uuid,
	"team_id" uuid,
	"name" text NOT NULL,
	"color" text NOT NULL,
	CONSTRAINT "calendars_one_owner_check" CHECK (("project_id" is not null)::int + ("owner_user_id" is not null)::int + ("team_id" is not null)::int = 1),
	CONSTRAINT "calendars_color_check" CHECK ("color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "event_attendees" (
	"event_id" uuid,
	"principal_type" text,
	"principal_id" uuid,
	"response" text DEFAULT 'needs_action' NOT NULL,
	CONSTRAINT "event_attendees_pkey" PRIMARY KEY("event_id","principal_type","principal_id"),
	CONSTRAINT "event_attendees_type_check" CHECK ("principal_type" in ('user', 'team')),
	CONSTRAINT "event_attendees_response_check" CHECK ("response" in ('needs_action', 'accepted', 'declined', 'tentative'))
);
--> statement-breakpoint
CREATE TABLE "event_reminders" (
	"event_id" uuid,
	"minutes_before" integer,
	CONSTRAINT "event_reminders_pkey" PRIMARY KEY("event_id","minutes_before"),
	CONSTRAINT "event_reminders_minutes_check" CHECK ("minutes_before" between 0 and 10080)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY,
	"calendar_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text NOT NULL,
	"rrule" text,
	"exdates" timestamp with time zone[] DEFAULT '{}'::timestamp with time zone[] NOT NULL,
	"recurrence_parent_id" uuid,
	"original_start" timestamp with time zone,
	"location" text DEFAULT '' NOT NULL,
	"description" jsonb,
	CONSTRAINT "events_range_check" CHECK ("ends_at" >= "starts_at"),
	CONSTRAINT "events_override_check" CHECK (("recurrence_parent_id" is null) = ("original_start" is null))
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" uuid,
	"kind" text,
	"channel" text,
	"enabled" boolean NOT NULL,
	CONSTRAINT "notification_prefs_pkey" PRIMARY KEY("user_id","kind","channel"),
	CONSTRAINT "notification_prefs_kind_check" CHECK ("kind" in ('task_due_soon', 'task_overdue', 'task_assigned', 'mention', 'doc_review_due', 'direct_message', 'thread_reply', 'task_unassigned', 'task_changed', 'comment_added', 'invite_accepted')),
	CONSTRAINT "notification_prefs_channel_check" CHECK ("channel" in ('in_app', 'push', 'email'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL UNIQUE,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "quiet_start" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "quiet_end" text;--> statement-breakpoint
CREATE INDEX "calendars_project_idx" ON "calendars" ("project_id");--> statement-breakpoint
CREATE INDEX "event_attendees_principal_idx" ON "event_attendees" ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "events_calendar_idx" ON "events" ("calendar_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_parent_idx" ON "events" ("recurrence_parent_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_id_entities_id_fkey" FOREIGN KEY ("id") REFERENCES "entities"("id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_id_calendars_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_recurrence_parent_id_events_id_fkey" FOREIGN KEY ("recurrence_parent_id") REFERENCES "events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_quiet_check" CHECK (("quiet_start" is null) = ("quiet_end" is null)
      and ("quiet_start" is null or "quiet_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      and ("quiet_end" is null or "quiet_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check", ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('task_due_soon', 'task_overdue', 'task_assigned', 'mention', 'doc_review_due', 'direct_message', 'thread_reply', 'task_unassigned', 'task_changed', 'comment_added', 'invite_accepted'));