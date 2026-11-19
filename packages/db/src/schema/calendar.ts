import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth.ts"
import { entityPk, timestamptz } from "./columns.ts"
import { entities, projects, teams } from "./core.ts"

const inList = (column: AnyPgColumn, values: ReadonlyArray<string>) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`

export const responseStatuses = ["needs_action", "accepted", "declined", "tentative"] as const
export const principalTypes = ["user", "team"] as const

/**
 * A calendar. Project calendars belong to their project (the entity parent); personal and team
 * calendars have no parent and are shared through `container_access`.
 */
export const calendars = pgTable(
  "calendars",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
  },
  (t) => [
    check(
      "calendars_one_owner_check",
      sql`(${t.projectId} is not null)::int + (${t.ownerUserId} is not null)::int + (${t.teamId} is not null)::int = 1`,
    ),
    check("calendars_color_check", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
    index("calendars_project_idx").on(t.projectId),
  ],
)

/**
 * One row per event or recurrence override. A series is a row with `rrule` and no
 * `recurrenceParentId`; an override has `recurrenceParentId` and `originalStart` (the occurrence
 * it replaces). `exdates` lists deleted occurrence starts of the series.
 */
export const events = pgTable(
  "events",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    timezone: text("timezone").notNull(),
    rrule: text("rrule"),
    exdates: timestamptz("exdates")
      .array()
      .notNull()
      .default(sql`'{}'`),
    recurrenceParentId: uuid("recurrence_parent_id").references((): AnyPgColumn => events.id, {
      onDelete: "cascade",
    }),
    originalStart: timestamptz("original_start"),
    location: text("location").notNull().default(""),
    description: jsonb("description").$type<Record<string, unknown>>(),
  },
  (t) => [
    check("events_range_check", sql`${t.endsAt} >= ${t.startsAt}`),
    check(
      "events_override_check",
      sql`(${t.recurrenceParentId} is null) = (${t.originalStart} is null)`,
    ),
    index("events_calendar_idx").on(t.calendarId, t.startsAt),
    index("events_parent_idx").on(t.recurrenceParentId),
  ],
)

export const eventAttendees = pgTable(
  "event_attendees",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull().$type<(typeof principalTypes)[number]>(),
    principalId: uuid("principal_id").notNull(),
    response: text("response")
      .notNull()
      .$type<(typeof responseStatuses)[number]>()
      .default("needs_action"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.principalType, t.principalId] }),
    check("event_attendees_type_check", inList(t.principalType, principalTypes)),
    check("event_attendees_response_check", inList(t.response, responseStatuses)),
    index("event_attendees_principal_idx").on(t.principalType, t.principalId),
  ],
)

export const eventReminders = pgTable(
  "event_reminders",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    minutesBefore: integer("minutes_before").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.minutesBefore] }),
    check("event_reminders_minutes_check", sql`${t.minutesBefore} between 0 and 10080`),
  ],
)
