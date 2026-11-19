/**
 * Calendar commands. A recurring event is a series row (RRULE without DTSTART; DTSTART is the
 * series `startsAt` in the event's timezone) plus child rows for edited occurrences
 * (`recurrenceParentId` + `originalStart`) and excluded starts (`exdates`). Attendees and
 * reminders belong to the series.
 */
import {
  accessEntries,
  calendars,
  entities,
  eventAttendees,
  eventReminders,
  events,
  messages,
  references,
  userProfiles,
} from "@audit/db/schema"
import { Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import type { CalendarId, EntityId, EventId, ProjectId, TeamId, UserId } from "@audit/domain/ids"
import type { ResourceAction } from "@audit/domain/permissions"
import * as S from "@audit/domain/calendar/schema"
import { Db } from "@audit/platform/database"
import { and, eq, gte, inArray, isNull } from "drizzle-orm"
import { createHash, randomBytes } from "node:crypto"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import {
  checkVersion,
  type EntityChanges,
  createEntity,
  lockEntity,
  softDeleteEntity,
  touchEntity,
} from "../entities.ts"
import { notify } from "../notifications/notify.ts"
import { emit, record } from "../trail.ts"
import { syncReferences } from "../references.ts"
import { eventSearchText } from "../search/text.ts"
import { isValidRule, countBefore, withCount, withUntil } from "./recurrence.ts"
import { scheduleReminders } from "./reminders.ts"
import { parseIcs } from "./ics.ts"
import { calendarRow, eventRow, type EventRow } from "./rows.ts"

export type { EventRow }

const requireOn = (action: ResourceAction, id: EntityId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn(action, id)
  })

const requireCapability = (capability: "teams.manage") =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability(capability)
  })

const duration = (row: { startsAt: Date; endsAt: Date }) =>
  row.endsAt.getTime() - row.startsAt.getTime()

const timingOf = (row: EventRow) => ({
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  timezone: row.timezone,
  rrule: row.rrule,
  exdates: row.exdates,
})

const checkTiming = (input: {
  startsAt: Date
  endsAt: Date
  rrule: string | null
  timezone: string
}) =>
  Effect.gen(function* () {
    if (input.endsAt.getTime() < input.startsAt.getTime())
      return yield* Effect.fail(
        new ValidationError({ message: "end must not precede start", field: "endsAt" }),
      )
    if (input.rrule !== null && !isValidRule(input.rrule))
      return yield* Effect.fail(
        new ValidationError({ message: "invalid recurrence rule", field: "rrule" }),
      )
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone })
    } catch {
      return yield* Effect.fail(
        new ValidationError({ message: "unknown timezone", field: "timezone" }),
      )
    }
  })

const titleOf = (id: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ title: entities.title })
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1)
    return row?.title ?? ""
  })

const projectIdOf = (id: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ projectId: entities.projectId })
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1)
    return (row?.projectId ?? null) as ProjectId | null
  })

/** Loads a live (not soft-deleted) event row. */
export const loadEventRow = (eventId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ event: events })
      .from(events)
      .innerJoin(entities, eq(entities.id, events.id))
      .where(and(eq(events.id, eventId), isNull(entities.deletedAt)))
      .limit(1)
    if (!row) return yield* Effect.fail(new NotFound({ entity: "event", id: eventId }))
    return eventRow(row.event)
  })

/** Live overrides of a series, optionally only those starting at or after `from`. */
const liveOverrides = (seriesId: EventId, from?: Date) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ event: events })
      .from(events)
      .innerJoin(entities, eq(entities.id, events.id))
      .where(
        and(
          eq(events.recurrenceParentId, seriesId),
          isNull(entities.deletedAt),
          from ? gte(events.originalStart, from) : undefined,
        ),
      )
    return rows.map((r) => eventRow(r.event))
  })

const findOverride = (seriesId: EventId, occurrence: Date) =>
  Effect.gen(function* () {
    const overrides = yield* liveOverrides(seriesId, occurrence)
    return overrides.find((o) => o.originalStart?.getTime() === occurrence.getTime()) ?? null
  })

const attendeesOf = (seriesId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({
        principalType: eventAttendees.principalType,
        principalId: eventAttendees.principalId,
      })
      .from(eventAttendees)
      .where(eq(eventAttendees.eventId, seriesId))
    return rows as ReadonlyArray<S.AttendeeInput>
  })

const remindersOf = (seriesId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ minutesBefore: eventReminders.minutesBefore })
      .from(eventReminders)
      .where(eq(eventReminders.eventId, seriesId))
    return rows.map((r) => r.minutesBefore)
  })

const childIds = (seriesId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.recurrenceParentId, seriesId))
    return rows.map((r) => r.id as EventId)
  })

/** Invitees can see the event rows (series and overrides) themselves, not only their calendar. */
const grantAttendees = (rowIds: EventId[], attendees: ReadonlyArray<S.AttendeeInput>) =>
  Effect.gen(function* () {
    const db = yield* Db
    if (rowIds.length === 0) return
    yield* db.delete(accessEntries).where(inArray(accessEntries.resourceId, rowIds))
    if (attendees.length === 0) return
    yield* db.insert(accessEntries).values(
      rowIds.flatMap((resourceId) =>
        attendees.map((a) => ({
          resourceId,
          principalType: a.principalType,
          principalId: a.principalId,
          role: "viewer" as const,
        })),
      ),
    )
  })

const replaceAttendees = (seriesId: EventId, attendees: ReadonlyArray<S.AttendeeInput>) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.delete(eventAttendees).where(eq(eventAttendees.eventId, seriesId))
    if (attendees.length > 0)
      yield* db.insert(eventAttendees).values(
        attendees.map((a) => ({
          eventId: seriesId,
          principalType: a.principalType,
          principalId: a.principalId,
        })),
      )
    yield* grantAttendees([seriesId, ...(yield* childIds(seriesId))], attendees)
  })

const replaceReminders = (seriesId: EventId, minutes: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.delete(eventReminders).where(eq(eventReminders.eventId, seriesId))
    if (minutes.length > 0)
      yield* db
        .insert(eventReminders)
        .values(minutes.map((minutesBefore) => ({ eventId: seriesId, minutesBefore })))
  })

/** Inserts an event row (series, single event or override) and its entity. */
const insertEvent = (input: {
  id: EventId
  calendarId: CalendarId
  projectId: ProjectId | null
  title: string
  startsAt: Date
  endsAt: Date
  allDay: boolean
  timezone: string
  rrule: string | null
  location: string
  description: unknown
  exdates?: ReadonlyArray<Date>
  recurrenceParentId?: EventId
  originalStart?: Date
}) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* createEntity({
      id: input.id,
      type: "event",
      title: input.title,
      searchText: eventSearchText(input.description, input.location),
      parentId: input.calendarId,
      projectId: input.projectId,
    })
    yield* db.insert(events).values({
      id: input.id,
      calendarId: input.calendarId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay,
      timezone: input.timezone,
      rrule: input.rrule,
      exdates: [...(input.exdates ?? [])],
      recurrenceParentId: input.recurrenceParentId ?? null,
      originalStart: input.originalStart ?? null,
      location: input.location,
      description: input.description as never,
    })
  })

/**
 * Touches an event entity after its row changed. Its search text follows the stored description
 * and location, so the row is read back here rather than trusting each caller's patch.
 */
const touchEvent = (id: EventId, changes: EntityChanges = {}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ description: events.description, location: events.location })
      .from(events)
      .where(eq(events.id, id))
      .pipe(Effect.orDie)
    return yield* touchEntity(id, {
      ...changes,
      searchText: eventSearchText(row?.description, row?.location ?? ""),
    })
  })

const emitEvent = (
  kind: "created" | "updated" | "deleted" | "rsvp_changed",
  calendarId: CalendarId,
  eventId: EventId,
  projectId: ProjectId | null,
  actorId: UserId,
) =>
  emit({
    _tag: "EventChanged",
    kind,
    entityId: eventId,
    projectId,
    actorId,
    version: null,
    calendarId,
    eventId,
  })

const emitCalendar = (
  kind: "created" | "updated" | "deleted",
  calendarId: CalendarId,
  projectId: ProjectId | null,
  actorId: UserId,
) =>
  emit({
    _tag: "CalendarChanged",
    kind,
    entityId: calendarId,
    projectId,
    actorId,
    version: null,
    calendarId,
  })

const calendarSummary = (id: CalendarId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ cal: calendars, version: entities.version })
      .from(calendars)
      .innerJoin(entities, eq(entities.id, calendars.id))
      .where(eq(calendars.id, id))
      .limit(1)
    if (!row) return yield* Effect.fail(new NotFound({ entity: "calendar", id }))
    return { ...calendarRow(row.cal), version: row.version }
  })

const calendarOf = (id: CalendarId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ projectId: calendars.projectId })
      .from(calendars)
      .innerJoin(entities, eq(entities.id, calendars.id))
      .where(and(eq(calendars.id, id), isNull(entities.deletedAt)))
      .limit(1)
    if (!row) return yield* Effect.fail(new NotFound({ entity: "calendar", id }))
    return { projectId: row.projectId as ProjectId | null }
  })

/** Team calendars grant editors on the team; personal ones grant the owner manager. */
const grantCalendar = (id: CalendarId, teamId: TeamId | null, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.insert(accessEntries).values(
      teamId === null
        ? {
            resourceId: id,
            principalType: "user",
            principalId: userId,
            principalRole: null,
            role: "manager",
            grantedBy: userId,
          }
        : {
            resourceId: id,
            principalType: "team",
            principalId: teamId,
            principalRole: null,
            role: "editor",
            grantedBy: userId,
          },
    )
  })

/** Inserts the project's default calendar; called from project creation. */
export const insertProjectCalendar = (projectId: ProjectId, name: string, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const id = Bun.randomUUIDv7() as CalendarId
    yield* createEntity({ id, type: "calendar", title: name, parentId: projectId, projectId })
    yield* db.insert(calendars).values({
      id,
      ownerUserId: null,
      teamId: null,
      projectId,
      name,
      color: "#4f46e5",
    })
    yield* grantCalendar(id, null, userId)
    const authz = yield* Authz
    yield* authz.rebuild({ containerId: id })
  })

export const createCalendar = Command.make("calendar.create", {
  input: S.CreateCalendarInput,
  output: S.CalendarSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      if (input.teamId != null && input.projectId !== undefined)
        return yield* Effect.fail(
          new ValidationError({
            message: "a calendar belongs to a team or a project, not both",
            field: "projectId",
          }),
        )
      if (input.projectId !== undefined)
        return yield* requireOn("calendar.create", input.projectId as EntityId)
      if (input.teamId != null) return yield* requireCapability("teams.manage")
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("calendar.create")
      const teamId = input.teamId ?? null
      const projectId = input.projectId ?? null
      const id = Bun.randomUUIDv7() as CalendarId
      yield* createEntity({
        id,
        type: "calendar",
        title: input.name,
        parentId: projectId,
        projectId,
      })
      yield* db.insert(calendars).values({
        id,
        ownerUserId: teamId === null && projectId === null ? userId : null,
        teamId,
        projectId,
        name: input.name,
        color: input.color,
      })
      yield* grantCalendar(id, teamId, userId)
      const authz = yield* Authz
      yield* authz.rebuild({ containerId: id })
      yield* record({
        action: "calendar.created",
        entityId: id,
        entityType: "calendar",
        projectId: null,
        details: { name: input.name },
      })
      yield* emitCalendar("created", id, null, userId)
      return yield* calendarSummary(id)
    }),
})

export const updateCalendar = Command.make("calendar.update", {
  input: Schema.Struct({ calendarId: Schema.String, patch: S.UpdateCalendarInput }),
  output: S.CalendarSummary,
  authorize: (input) => requireOn("calendar.settings", input.calendarId as EntityId),
  run: ({ calendarId: rawId, patch }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("calendar.update")
      const calendarId = rawId as CalendarId
      const row = yield* lockEntity(calendarId, "calendar")
      yield* checkVersion(row, patch.version)
      const cal = yield* calendarOf(calendarId)
      yield* db
        .update(calendars)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
        })
        .where(eq(calendars.id, calendarId))
      yield* touchEntity(calendarId, patch.name !== undefined ? { title: patch.name } : {})
      yield* record({
        action: "calendar.updated",
        entityId: calendarId,
        entityType: "calendar",
        projectId: cal.projectId,
        details: { name: patch.name ?? null },
      })
      yield* emitCalendar("updated", calendarId, cal.projectId, userId)
      return yield* calendarSummary(calendarId)
    }),
})

export const deleteCalendar = Command.make("calendar.delete", {
  input: Schema.Struct({ calendarId: Schema.String }),
  output: Schema.Void,
  authorize: (input) => requireOn("calendar.delete", input.calendarId as EntityId),
  run: ({ calendarId: rawId }) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("calendar.delete")
      const calendarId = rawId as CalendarId
      const cal = yield* calendarOf(calendarId)
      yield* softDeleteEntity(calendarId)
      yield* record({
        action: "calendar.deleted",
        entityId: calendarId,
        entityType: "calendar",
        projectId: cal.projectId,
        details: {},
      })
      yield* emitCalendar("deleted", calendarId, cal.projectId, userId)
    }),
})

export const createEvent = Command.make("event.create", {
  input: S.EventInput,
  output: S.EventOccurrence,
  authorize: (input) => requireOn("event.create", input.calendarId as EntityId),
  run: (event) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("event.create")
      const calendarId = event.calendarId as CalendarId
      const cal = yield* calendarOf(calendarId)
      yield* checkTiming(event)
      const id = Bun.randomUUIDv7() as EventId
      yield* insertEvent({
        id,
        calendarId,
        projectId: cal.projectId,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        timezone: event.timezone,
        rrule: event.rrule,
        location: event.location,
        description: event.description,
      })
      yield* replaceAttendees(id, event.attendees)
      yield* replaceReminders(id, event.reminders)
      yield* notifyAttendees(id, "event_invited", userId, event.title)
      yield* scheduleReminders(id)
      yield* record({
        action: "event.created",
        entityId: id,
        entityType: "event",
        projectId: cal.projectId,
        details: { title: event.title },
      })
      yield* emitEvent("created", calendarId, id, cal.projectId, userId)
      return {
        eventId: id,
        calendarId,
        title: event.title,
        occurrenceStart: event.startsAt,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        timezone: event.timezone,
        rrule: event.rrule,
        isOverride: false,
        location: event.location,
        description: event.description,
        attendees: event.attendees.map((a) => ({ ...a, response: "needs_action" as const })),
        reminders: [...event.reminders],
        version: 1,
        createdBy: userId,
        links: [],
      }
    }),
})

/** Notifies the user attendees of a series (not the actor) that it was created or changed. */
const notifyAttendees = (
  seriesId: EventId,
  kind: "event_invited" | "event_changed",
  actorId: UserId,
  title: string,
) =>
  Effect.gen(function* () {
    const projectId = yield* projectIdOf(seriesId)
    const attendees = yield* attendeesOf(seriesId)
    for (const attendee of attendees) {
      if (attendee.principalType !== "user" || attendee.principalId === actorId) continue
      yield* notify({
        userId: attendee.principalId as UserId,
        kind,
        entityId: seriesId,
        projectId,
        actorId,
        payload: { title },
        groupKey: `${kind}:${seriesId}`,
      })
    }
  })

/** Times of a single occurrence after patching; `endsAt` defaults to keep the duration. */
const resolveTimes = (
  base: { startsAt: Date; endsAt: Date },
  patch: { startsAt?: Date; endsAt?: Date },
) => {
  const startsAt = patch.startsAt ?? base.startsAt
  const endsAt =
    patch.endsAt ?? (patch.startsAt ? new Date(startsAt.getTime() + duration(base)) : base.endsAt)
  return { startsAt, endsAt }
}

/** Rejects moving an event to another calendar; moves are not supported yet. */
const checkCalendarUnchanged = (row: EventRow, calendarId: string | undefined) =>
  calendarId === undefined || calendarId === row.calendarId
    ? Effect.void
    : Effect.fail(
        new ValidationError({
          message: "moving events between calendars is not supported",
          field: "calendarId",
        }),
      )

const updateSingle = (row: EventRow, patch: S.UpdateEventInput, actorId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* checkCalendarUnchanged(row, patch.calendarId)
    const { startsAt, endsAt } = resolveTimes(row, patch)
    const timezone = patch.timezone ?? row.timezone
    yield* checkTiming({ startsAt, endsAt, rrule: row.rrule, timezone })
    yield* db
      .update(events)
      .set({
        startsAt,
        endsAt,
        timezone,
        allDay: patch.allDay ?? row.allDay,
        location: patch.location ?? row.location,
        description:
          patch.description !== undefined ? (patch.description as never) : row.description,
      })
      .where(eq(events.id, row.id))
    if (patch.title !== undefined) yield* touchEvent(row.id, { title: patch.title })
    else yield* touchEvent(row.id)
    if (patch.attendees !== undefined) yield* replaceAttendees(row.id, patch.attendees)
    if (patch.reminders !== undefined) yield* replaceReminders(row.id, patch.reminders)
    yield* scheduleReminders(row.id)
    yield* notifyAttendees(
      row.id,
      "event_changed",
      actorId,
      patch.title ?? (yield* titleOf(row.id)),
    )
    yield* emitEvent(
      "updated",
      row.calendarId as CalendarId,
      row.id,
      yield* projectIdOf(row.id),
      actorId,
    )
  })

/** Edits one occurrence by writing an override row for it. */
const updateThis = (
  series: EventRow,
  occurrence: Date,
  patch: S.UpdateEventInput,
  actorId: UserId,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* checkCalendarUnchanged(series, patch.calendarId)
    const existing = yield* findOverride(series.id, occurrence)
    const base = existing ?? {
      startsAt: occurrence,
      endsAt: new Date(occurrence.getTime() + duration(series)),
    }
    const { startsAt, endsAt } = resolveTimes(base, patch)
    const timezone = patch.timezone ?? series.timezone
    yield* checkTiming({ startsAt, endsAt, rrule: null, timezone })
    const allDay = patch.allDay ?? series.allDay
    const location = patch.location ?? series.location
    const description = patch.description !== undefined ? patch.description : series.description
    if (existing) {
      yield* db
        .update(events)
        .set({ startsAt, endsAt, timezone, allDay, location, description: description as never })
        .where(eq(events.id, existing.id))
      yield* touchEvent(existing.id, patch.title !== undefined ? { title: patch.title } : {})
      yield* emitEvent(
        "updated",
        series.calendarId as CalendarId,
        existing.id,
        yield* projectIdOf(existing.id),
        actorId,
      )
      return
    }
    const id = Bun.randomUUIDv7() as EventId
    yield* insertEvent({
      id,
      calendarId: series.calendarId as CalendarId,
      projectId: yield* projectIdOf(series.id),
      title: patch.title ?? (yield* titleOf(series.id)),
      startsAt,
      endsAt,
      allDay,
      timezone,
      rrule: null,
      location,
      description,
      recurrenceParentId: series.id,
      originalStart: occurrence,
    })
    yield* emitEvent(
      "updated",
      series.calendarId as CalendarId,
      id,
      yield* projectIdOf(series.id),
      actorId,
    )
  })

/** Splits the series at `occurrence`: earlier occurrences keep the old series, the rest move to a new one. */
const updateFollowing = (
  series: EventRow,
  occurrence: Date,
  patch: S.UpdateEventInput,
  actorId: UserId,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* checkCalendarUnchanged(series, patch.calendarId)
    const startsAt = patch.startsAt ?? occurrence
    const endsAt = patch.endsAt ?? new Date(startsAt.getTime() + duration(series))
    const rrule = patch.rrule !== undefined ? patch.rrule : series.rrule
    const timezone = patch.timezone ?? series.timezone
    yield* checkTiming({ startsAt, endsAt, rrule, timezone })
    const projectId = yield* projectIdOf(series.id)
    const id = Bun.randomUUIDv7() as EventId
    const before = countBefore(timingOf(series), occurrence)
    yield* insertEvent({
      id,
      calendarId: series.calendarId as CalendarId,
      projectId,
      title: patch.title ?? (yield* titleOf(series.id)),
      startsAt,
      endsAt,
      allDay: patch.allDay ?? series.allDay,
      timezone,
      rrule,
      location: patch.location ?? series.location,
      description: patch.description !== undefined ? patch.description : series.description,
      exdates: series.exdates.filter((d) => d.getTime() >= occurrence.getTime()),
    })
    const attendees = patch.attendees ?? (yield* attendeesOf(series.id))
    yield* replaceAttendees(id, attendees)
    yield* replaceReminders(id, patch.reminders ?? (yield* remindersOf(series.id)))
    yield* db
      .update(events)
      .set({ recurrenceParentId: id })
      .where(and(eq(events.recurrenceParentId, series.id), gte(events.originalStart, occurrence)))
    yield* grantAttendees(yield* childIds(id), attendees)
    if (before === 0) {
      yield* softDeleteEntity(series.id)
    } else {
      const cut =
        series.rrule !== null && /(^|;)COUNT=/.test(series.rrule)
          ? withCount(series.rrule, before)
          : withUntil(series.rrule ?? "", new Date(occurrence.getTime() - 1))
      yield* db
        .update(events)
        .set({
          rrule: cut,
          exdates: series.exdates.filter((d) => d.getTime() < occurrence.getTime()),
        })
        .where(eq(events.id, series.id))
      yield* touchEvent(series.id)
      yield* scheduleReminders(series.id)
    }
    yield* scheduleReminders(id)
    yield* emitEvent("updated", series.calendarId as CalendarId, id, projectId, actorId)
  })

/** Edits every occurrence: shifts the series by the delta from `occurrence` and replaces fields. */
const updateAll = (
  series: EventRow,
  occurrence: Date,
  patch: S.UpdateEventInput,
  actorId: UserId,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* checkCalendarUnchanged(series, patch.calendarId)
    const startDelta = patch.startsAt ? patch.startsAt.getTime() - occurrence.getTime() : 0
    const endDelta = patch.endsAt
      ? patch.endsAt.getTime() - (occurrence.getTime() + duration(series))
      : startDelta
    const startsAt = new Date(series.startsAt.getTime() + startDelta)
    const endsAt = new Date(series.endsAt.getTime() + endDelta)
    const rrule = patch.rrule !== undefined ? patch.rrule : series.rrule
    const timezone = patch.timezone ?? series.timezone
    yield* checkTiming({ startsAt, endsAt, rrule, timezone })
    yield* db
      .update(events)
      .set({
        startsAt,
        endsAt,
        rrule,
        timezone,
        allDay: patch.allDay ?? series.allDay,
        location: patch.location ?? series.location,
        description:
          patch.description !== undefined ? (patch.description as never) : series.description,
        exdates: series.exdates.map((d) => new Date(d.getTime() + startDelta)),
      })
      .where(eq(events.id, series.id))
    for (const override of yield* liveOverrides(series.id)) {
      if (override.originalStart === null) continue
      yield* db
        .update(events)
        .set({ originalStart: new Date(override.originalStart.getTime() + startDelta) })
        .where(eq(events.id, override.id))
    }
    if (patch.title !== undefined) yield* touchEvent(series.id, { title: patch.title })
    else yield* touchEvent(series.id)
    if (patch.attendees !== undefined) yield* replaceAttendees(series.id, patch.attendees)
    if (patch.reminders !== undefined) yield* replaceReminders(series.id, patch.reminders)
    yield* scheduleReminders(series.id)
    yield* notifyAttendees(
      series.id,
      "event_changed",
      actorId,
      patch.title ?? (yield* titleOf(series.id)),
    )
    yield* emitEvent(
      "updated",
      series.calendarId as CalendarId,
      series.id,
      yield* projectIdOf(series.id),
      actorId,
    )
  })

export const updateEvent = Command.make("event.update", {
  input: Schema.Struct({ eventId: Schema.String, patch: S.UpdateEventInput }),
  output: Schema.Void,
  authorize: (input) => requireOn("event.update", input.eventId as EntityId),
  run: ({ eventId: rawId, patch }) =>
    Effect.gen(function* () {
      const actorId = yield* currentUser("event.update")
      const eventId = rawId as EventId
      const entityRow = yield* lockEntity(eventId, "event")
      yield* checkVersion(entityRow, patch.version)
      const row = yield* loadEventRow(eventId)
      if (row.rrule === null && row.recurrenceParentId === null)
        return yield* updateSingle(row, patch, actorId)
      const series = row.recurrenceParentId ? yield* loadEventRow(row.recurrenceParentId) : row
      const occurrence = new Date(patch.occurrenceStart ?? row.originalStart ?? row.startsAt)
      if (series.rrule === null) return yield* updateSingle(series, patch, actorId)
      if (patch.scope === "this") return yield* updateThis(series, occurrence, patch, actorId)
      if (patch.scope === "following")
        return yield* updateFollowing(series, occurrence, patch, actorId)
      return yield* updateAll(series, occurrence, patch, actorId)
    }),
})

/** Targets an event can be scheduled for: the entity type and the read action gating it. */
const linkTargets = {
  task: { type: "task", read: "task.read" },
  doc: { type: "doc", read: "doc.read" },
  thread: { type: "message", read: "message.read" },
} as const

/** Resolves a link target the actor may read. Missing, deleted, wrong-kind and unreadable targets
 * all fail with the same NotFound, so nothing about invisible items leaks. */
const readableLinkTarget = (kind: S.EventLinkKind, targetId: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const target = linkTargets[kind]
    const missing = new NotFound({ entity: "entity", id: targetId })
    const [row] = yield* db
      .select({ type: entities.type, deletedAt: entities.deletedAt })
      .from(entities)
      .where(eq(entities.id, targetId))
    if (row === undefined || row.deletedAt !== null || row.type !== target.type)
      return yield* Effect.fail(missing)
    yield* authz
      .requireOn(target.read, targetId)
      .pipe(Effect.catchTag("NotFound", () => Effect.fail(missing)))
    if (kind === "thread") {
      const [message] = yield* db
        .select({ threadRootId: messages.threadRootId })
        .from(messages)
        .where(eq(messages.id, targetId))
      if (message?.threadRootId != null)
        return yield* Effect.fail(
          new ValidationError({
            message: "only a thread's root message can be linked",
            field: "targetId",
          }),
        )
    }
    return targetId
  })

/** Targets currently linked to an event series through `scheduled_for` references. */
const scheduledTargets = (seriesId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ targetId: references.targetId })
      .from(references)
      .where(and(eq(references.sourceId, seriesId), eq(references.kind, "scheduled_for")))
    return rows.map((row) => row.targetId as EntityId)
  })

export const linkEvent = Command.make("event.link", {
  input: Schema.Struct({ eventId: Schema.String, ...S.LinkEventInput.fields }),
  output: Schema.Void,
  authorize: (input) => requireOn("event.update", input.eventId as EntityId),
  run: ({ eventId: rawId, kind, targetId: rawTarget }) =>
    Effect.gen(function* () {
      const actorId = yield* currentUser("event.link")
      const row = yield* loadEventRow(rawId as EventId)
      const seriesId = (row.recurrenceParentId ?? row.id) as EventId
      const targetId = yield* readableLinkTarget(kind, rawTarget as EntityId)
      const current = yield* scheduledTargets(seriesId)
      if (current.includes(targetId)) return
      yield* syncReferences(
        seriesId as EntityId,
        "scheduled_for",
        [...current, targetId].map((id) => ({ targetId: id })),
      ).pipe(Effect.orDie)
      const cal = yield* calendarOf(row.calendarId)
      yield* record({
        action: "event.linked",
        entityId: seriesId as EntityId,
        entityType: "event",
        projectId: cal.projectId,
        details: { kind, targetId },
      })
      yield* emitEvent("updated", row.calendarId, seriesId, cal.projectId, actorId)
    }),
})

export const unlinkEvent = Command.make("event.unlink", {
  input: Schema.Struct({ eventId: Schema.String, ...S.UnlinkEventInput.fields }),
  output: Schema.Void,
  authorize: (input) => requireOn("event.update", input.eventId as EntityId),
  run: ({ eventId: rawId, kind, targetId: rawTarget }) =>
    Effect.gen(function* () {
      const actorId = yield* currentUser("event.unlink")
      const row = yield* loadEventRow(rawId as EventId)
      const seriesId = (row.recurrenceParentId ?? row.id) as EventId
      const current = yield* scheduledTargets(seriesId)
      const remaining = current.filter((id) => id !== rawTarget)
      if (remaining.length === current.length) return
      yield* syncReferences(
        seriesId as EntityId,
        "scheduled_for",
        remaining.map((id) => ({ targetId: id })),
      ).pipe(Effect.orDie)
      const cal = yield* calendarOf(row.calendarId)
      yield* record({
        action: "event.unlinked",
        entityId: seriesId as EntityId,
        entityType: "event",
        projectId: cal.projectId,
        details: { kind, targetId: rawTarget },
      })
      yield* emitEvent("updated", row.calendarId, seriesId, cal.projectId, actorId)
    }),
})

export const deleteEvent = Command.make("event.delete", {
  input: Schema.Struct({ eventId: Schema.String, patch: S.DeleteEventInput }),
  output: Schema.Void,
  authorize: (input) => requireOn("event.delete", input.eventId as EntityId),
  run: ({ eventId: rawId, patch }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const actorId = yield* currentUser("event.delete")
      const eventId = rawId as EventId
      const entityRow = yield* lockEntity(eventId, "event")
      yield* checkVersion(entityRow, patch.version)
      const row = yield* loadEventRow(eventId)
      const series = row.recurrenceParentId ? yield* loadEventRow(row.recurrenceParentId) : row
      const calendarId = series.calendarId as CalendarId
      const projectId = yield* projectIdOf(series.id)
      const occurrence = new Date(patch.occurrenceStart ?? row.originalStart ?? row.startsAt)
      if (series.rrule === null) {
        yield* softDeleteEntity(series.id)
      } else if (patch.scope === "this") {
        const existing = yield* findOverride(series.id, occurrence)
        if (existing) yield* softDeleteEntity(existing.id)
        yield* db
          .update(events)
          .set({ exdates: [...series.exdates, occurrence] })
          .where(eq(events.id, series.id))
        yield* touchEvent(series.id)
        yield* scheduleReminders(series.id)
      } else if (patch.scope === "following") {
        for (const override of yield* liveOverrides(series.id, occurrence))
          yield* softDeleteEntity(override.id)
        const before = countBefore(timingOf(series), occurrence)
        if (before === 0) {
          yield* softDeleteEntity(series.id)
        } else {
          const cut = /(^|;)COUNT=/.test(series.rrule)
            ? withCount(series.rrule, before)
            : withUntil(series.rrule, new Date(occurrence.getTime() - 1))
          yield* db
            .update(events)
            .set({
              rrule: cut,
              exdates: series.exdates.filter((d) => d.getTime() < occurrence.getTime()),
            })
            .where(eq(events.id, series.id))
          yield* touchEvent(series.id)
          yield* scheduleReminders(series.id)
        }
      } else {
        for (const override of yield* liveOverrides(series.id)) yield* softDeleteEntity(override.id)
        yield* softDeleteEntity(series.id)
      }
      yield* record({
        action: "event.deleted",
        entityId: series.id,
        entityType: "event",
        projectId,
        details: { scope: patch.scope },
      })
      yield* emitEvent("deleted", calendarId, series.id, projectId, actorId)
    }),
})

export const rsvp = Command.make("event.rsvp", {
  input: Schema.Struct({ eventId: Schema.String, response: S.RsvpInput.fields.response }),
  output: Schema.Void,
  // Invitees may respond without a calendar grant; `run` enforces that the caller is invited.
  authorize: () => Effect.void,
  run: ({ eventId: rawId, response }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("event.rsvp")
      const row = yield* loadEventRow(rawId as EventId)
      const seriesId = (row.recurrenceParentId ?? row.id) as EventId
      const [attendee] = yield* db
        .select({ principalId: eventAttendees.principalId })
        .from(eventAttendees)
        .where(
          and(
            eq(eventAttendees.eventId, seriesId),
            eq(eventAttendees.principalType, "user"),
            eq(eventAttendees.principalId, userId),
          ),
        )
        .limit(1)
      if (!attendee)
        return yield* Effect.fail(
          new Forbidden({ action: "event.rsvp", message: "only invited attendees can respond" }),
        )
      yield* db
        .update(eventAttendees)
        .set({ response })
        .where(
          and(
            eq(eventAttendees.eventId, seriesId),
            eq(eventAttendees.principalType, "user"),
            eq(eventAttendees.principalId, userId),
          ),
        )
      yield* emitEvent(
        "rsvp_changed",
        row.calendarId as CalendarId,
        seriesId,
        yield* projectIdOf(seriesId),
        userId,
      )
    }),
})

export const importIcs = Command.make("calendar.import", {
  input: S.ImportInput,
  output: S.ImportResult,
  authorize: (input) => requireOn("event.create", input.calendarId as EntityId),
  run: ({ calendarId: rawId, ics }) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("calendar.import")
      const calendarId = rawId as CalendarId
      const cal = yield* calendarOf(calendarId)
      const items = parseIcs(ics)
      const seriesByUid = new Map<string, EventId>()
      for (const item of items) {
        if (item.recurrenceId !== null) continue
        yield* checkTiming({
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          rrule: item.rrule,
          timezone: item.timezone,
        })
        const id = Bun.randomUUIDv7() as EventId
        if (!seriesByUid.has(item.uid)) seriesByUid.set(item.uid, id)
        yield* insertEvent({
          id,
          calendarId,
          projectId: cal.projectId,
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          allDay: item.allDay,
          timezone: item.timezone,
          rrule: item.rrule,
          location: item.location,
          description: null,
          exdates: item.exdates,
        })
      }
      for (const item of items) {
        const originalStart = item.recurrenceId
        if (originalStart === null) continue
        yield* checkTiming({
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          rrule: null,
          timezone: item.timezone,
        })
        // An override whose series is missing from the file is kept as a standalone event.
        const parentId = seriesByUid.get(item.uid)
        yield* insertEvent({
          id: Bun.randomUUIDv7() as EventId,
          calendarId,
          projectId: cal.projectId,
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          allDay: item.allDay,
          timezone: item.timezone,
          rrule: null,
          location: item.location,
          description: null,
          exdates: [],
          ...(parentId === undefined ? {} : { recurrenceParentId: parentId, originalStart }),
        })
      }
      yield* emitCalendar("updated", calendarId, cal.projectId, userId)
      return { imported: items.length }
    }),
})

/** Issues a new feed token for the caller; the previous token stops working. */
export const regenerateIcalFeed = Command.make("ical.regenerate", {
  input: Schema.Struct({}),
  output: S.IcalFeed,
  authorize: () => Effect.void,
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("ical.regenerate")
      const token = randomBytes(32).toString("base64url")
      const hash = createHash("sha256").update(token).digest("hex")
      const updated = yield* db
        .update(userProfiles)
        .set({ icalTokenHash: hash })
        .where(eq(userProfiles.userId, userId))
        .returning({ userId: userProfiles.userId })
      if (updated.length === 0)
        return yield* Effect.fail(new NotFound({ entity: "user", id: userId }))
      return { url: `/ical/${token}.ics` }
    }),
})
