/**
 * Drizzle rows carry plain strings for ids; these types and mappers brand the ids that the
 * calendar code and its schemas expect. Every calendar read goes through one of them.
 */
import type { calendars, events } from "@audit/db/schema"
import type { CalendarId, EventId, ProjectId, TeamId, UserId } from "@audit/domain/ids"

type EventDbRow = typeof events.$inferSelect
type CalendarDbRow = typeof calendars.$inferSelect

export type EventRow = Omit<EventDbRow, "id" | "calendarId" | "recurrenceParentId"> & {
  readonly id: EventId
  readonly calendarId: CalendarId
  readonly recurrenceParentId: EventId | null
}

export const eventRow = (row: EventDbRow): EventRow => ({
  ...row,
  id: row.id as EventId,
  calendarId: row.calendarId as CalendarId,
  recurrenceParentId: row.recurrenceParentId as EventId | null,
})

export type CalendarRow = Omit<CalendarDbRow, "id" | "projectId" | "ownerUserId" | "teamId"> & {
  readonly id: CalendarId
  readonly projectId: ProjectId | null
  readonly ownerUserId: UserId | null
  readonly teamId: TeamId | null
}

export const calendarRow = (row: CalendarDbRow): CalendarRow => ({
  ...row,
  id: row.id as CalendarId,
  projectId: row.projectId as ProjectId | null,
  ownerUserId: row.ownerUserId as UserId | null,
  teamId: row.teamId as TeamId | null,
})
