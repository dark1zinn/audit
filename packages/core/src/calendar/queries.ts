/**
 * Calendar reads. Visibility is enforced with `visibleTo` on the caller's id so the same code
 * serves the authenticated API and the token-authenticated iCal feed.
 */
import {
  calendars,
  entities,
  eventAttendees,
  eventReminders,
  events,
  references,
  userProfiles,
} from "@audit/db/schema"
import { NotFound, ValidationError } from "@audit/domain/errors"
import type { UserId } from "@audit/domain/ids"
import * as S from "@audit/domain/calendar/schema"
import { Db } from "@audit/platform/database"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { createHash } from "node:crypto"
import { Effect, Schema } from "effect"
import { visibleTo } from "../access.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { renderIcs, type IcsEvent } from "./ics.ts"
import { occurrenceStarts, type SeriesTiming } from "./recurrence.ts"
import { calendarRow, eventRow, type EventRow } from "./rows.ts"

type Occurrence = S.EventOccurrence

const parseDate = (value: string, field: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? Effect.fail(new ValidationError({ message: "invalid date", field }))
    : Effect.succeed(date)
}

/** Live calendars the user can see, with their entity version. */
export const calendarsVisibleTo = (userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ cal: calendars, version: entities.version })
      .from(calendars)
      .innerJoin(entities, eq(entities.id, calendars.id))
      .where(and(isNull(entities.deletedAt), visibleTo(userId, sql`${calendars.id}`)))
    return rows.map((r) => ({ ...calendarRow(r.cal), version: r.version }))
  })

/** Expanded occurrences of every visible event overlapping [from, to), sorted by start. */
export const occurrencesIn = (userId: UserId, from: Date, to: Date) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = (yield* db
      .select({
        ev: events,
        title: entities.title,
        version: entities.version,
        createdBy: entities.createdBy,
      })
      .from(events)
      .innerJoin(entities, eq(entities.id, events.id))
      .where(and(isNull(entities.deletedAt), visibleTo(userId, sql`${events.id}`)))).map((r) => ({
      ...r,
      ev: eventRow(r.ev),
      createdBy: r.createdBy as UserId | null,
    }))
    const seriesRows = rows.filter((r) => r.ev.recurrenceParentId === null)
    const overrideRows = rows.filter((r) => r.ev.recurrenceParentId !== null)
    const seriesIds = seriesRows.map((r) => r.ev.id)
    const attendeeRows =
      seriesIds.length === 0
        ? []
        : yield* db
            .select({
              eventId: eventAttendees.eventId,
              principalType: eventAttendees.principalType,
              principalId: eventAttendees.principalId,
              response: eventAttendees.response,
            })
            .from(eventAttendees)
            .where(inArray(eventAttendees.eventId, seriesIds))
    const reminderRows =
      seriesIds.length === 0
        ? []
        : yield* db
            .select({
              eventId: eventReminders.eventId,
              minutesBefore: eventReminders.minutesBefore,
            })
            .from(eventReminders)
            .where(inArray(eventReminders.eventId, seriesIds))

    const linkRefs =
      seriesIds.length === 0
        ? []
        : yield* db
            .select({ sourceId: references.sourceId, targetId: references.targetId })
            .from(references)
            .where(
              and(inArray(references.sourceId, seriesIds), eq(references.kind, "scheduled_for")),
            )
    const linkTargetIds = [...new Set(linkRefs.map((r) => r.targetId))]
    const linkTargetRows =
      linkTargetIds.length === 0
        ? []
        : yield* db
            .select({
              id: entities.id,
              type: entities.type,
              title: entities.title,
              deletedAt: entities.deletedAt,
            })
            .from(entities)
            .where(inArray(entities.id, linkTargetIds))
    const readableRows =
      linkTargetIds.length === 0
        ? []
        : yield* db
            .select({ id: entities.id })
            .from(entities)
            .where(and(inArray(entities.id, linkTargetIds), visibleTo(userId, sql`${entities.id}`)))
    const readable = new Set(readableRows.map((r) => r.id))
    const linkKinds: Record<string, S.EventLinkKind | undefined> = {
      task: "task",
      doc: "doc",
      message: "thread",
    }
    const linkByTarget = new Map<string, S.EventLink>()
    for (const row of linkTargetRows) {
      const kind = linkKinds[row.type]
      if (kind === undefined || row.deletedAt !== null) continue
      const visible = readable.has(row.id)
      linkByTarget.set(row.id, {
        kind,
        id: row.id,
        title: visible ? row.title : null,
        restricted: !visible,
      })
    }
    const linksBySeries = new Map<string, S.EventLink[]>()
    for (const ref of linkRefs) {
      const link = linkByTarget.get(ref.targetId)
      if (link === undefined) continue
      linksBySeries.set(ref.sourceId, [...(linksBySeries.get(ref.sourceId) ?? []), link])
    }

    const out: Occurrence[] = []
    const overlaps = (start: Date, end: Date) =>
      start.getTime() < to.getTime() && end.getTime() > from.getTime()

    for (const series of seriesRows) {
      const ev = series.ev
      const timing: SeriesTiming = {
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        timezone: ev.timezone,
        rrule: ev.rrule,
        exdates: ev.exdates,
      }
      const attendees = attendeeRows
        .filter((a) => a.eventId === ev.id)
        .map((a) => ({
          principalType: a.principalType,
          principalId: a.principalId,
          response: a.response,
        }))
      const reminders = reminderRows.filter((r) => r.eventId === ev.id).map((r) => r.minutesBefore)
      const links = linksBySeries.get(ev.id) ?? []
      const base = (start: Date, end: Date): Occurrence => ({
        eventId: ev.id,
        calendarId: ev.calendarId,
        title: series.title,
        occurrenceStart: start,
        startsAt: start,
        endsAt: end,
        allDay: ev.allDay,
        timezone: ev.timezone,
        rrule: ev.rrule,
        isOverride: false,
        location: ev.location,
        description: ev.description,
        attendees,
        reminders,
        links,
        version: series.version,
        createdBy: series.createdBy,
      })
      const overrides = overrideRows.filter((o) => o.ev.recurrenceParentId === ev.id)
      const byOriginal = new Map(
        overrides
          .filter((o) => o.ev.originalStart !== null)
          .map((o) => [o.ev.originalStart?.getTime() ?? 0, o] as const),
      )
      const starts = occurrenceStarts(timing, from, to)
      const startMs = new Set(starts.map((s) => s.getTime()))
      for (const start of starts) {
        const override = byOriginal.get(start.getTime())
        if (!override) {
          const end = new Date(start.getTime() + (ev.endsAt.getTime() - ev.startsAt.getTime()))
          out.push(base(start, end))
          continue
        }
        if (overlaps(override.ev.startsAt, override.ev.endsAt))
          out.push(overrideOccurrence(override, series.title, ev, attendees, reminders, links))
      }
      for (const override of overrides) {
        const original = override.ev.originalStart?.getTime()
        if (original === undefined || startMs.has(original)) continue
        if (overlaps(override.ev.startsAt, override.ev.endsAt))
          out.push(overrideOccurrence(override, series.title, ev, attendees, reminders, links))
      }
    }
    out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    return out
  })

const overrideOccurrence = (
  override: {
    ev: EventRow
    title: string
    version: number
    createdBy: UserId | null
  },
  seriesTitle: string,
  series: EventRow,
  attendees: Occurrence["attendees"],
  reminders: ReadonlyArray<number>,
  links: ReadonlyArray<S.EventLink>,
): Occurrence => ({
  eventId: override.ev.id,
  calendarId: override.ev.calendarId,
  title: override.title || seriesTitle,
  occurrenceStart: override.ev.originalStart ?? override.ev.startsAt,
  startsAt: override.ev.startsAt,
  endsAt: override.ev.endsAt,
  allDay: override.ev.allDay,
  timezone: override.ev.timezone,
  rrule: series.rrule,
  isOverride: true,
  location: override.ev.location,
  description: override.ev.description,
  attendees,
  reminders: [...reminders],
  version: override.version,
  createdBy: override.createdBy,
  links: [...links],
})

export const listCalendars = Command.make("calendar.list", {
  input: Schema.Struct({}),
  output: Schema.Array(S.CalendarSummary),
  authorize: () => Effect.void,
  run: () =>
    Effect.gen(function* () {
      const userId = yield* currentUser("calendar.list")
      return yield* calendarsVisibleTo(userId)
    }),
})

export const listEvents = Command.make("event.list", {
  input: S.EventsQuery,
  output: Schema.Array(S.EventOccurrence),
  authorize: () => Effect.void,
  run: (query) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("event.list")
      const from = yield* parseDate(query.from, "from")
      const to = yield* parseDate(query.to, "to")
      if (to.getTime() <= from.getTime())
        return yield* Effect.fail(
          new ValidationError({ message: "to must be after from", field: "to" }),
        )
      return yield* occurrencesIn(userId, from, to)
    }),
})

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex")

/** The UID a series and its edited occurrences share in the iCal feed. */
export const icsUid = (eventId: string) => `${eventId}@audit`

/**
 * The caller's live series and edited occurrences as iCal components. A series is one VEVENT with
 * its RRULE and EXDATEs; each override is a VEVENT with RECURRENCE-ID under the series UID.
 */
const feedEvents = (userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = (yield* db
      .select({ ev: events, title: entities.title })
      .from(events)
      .innerJoin(entities, eq(entities.id, events.id))
      .where(and(isNull(entities.deletedAt), visibleTo(userId, sql`${events.id}`)))).map((r) => ({
      ev: eventRow(r.ev),
      title: r.title,
    }))
    const series = new Map(
      rows.filter((r) => r.ev.recurrenceParentId === null).map((r) => [r.ev.id, r] as const),
    )
    const out: IcsEvent[] = []
    for (const { ev, title } of series.values()) {
      out.push({
        uid: icsUid(ev.id),
        title,
        location: ev.location,
        allDay: ev.allDay,
        timezone: ev.timezone,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        rrule: ev.rrule,
        exdates: ev.exdates,
        recurrence: null,
      })
    }
    for (const { ev, title } of rows) {
      if (ev.recurrenceParentId === null || ev.originalStart === null) continue
      const parent = series.get(ev.recurrenceParentId)
      if (parent === undefined) continue
      out.push({
        uid: icsUid(parent.ev.id),
        title: title || parent.title,
        location: ev.location,
        allDay: ev.allDay,
        timezone: ev.timezone,
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        rrule: null,
        exdates: [],
        recurrence: {
          at: ev.originalStart,
          timezone: parent.ev.timezone,
          allDay: parent.ev.allDay,
        },
      })
    }
    return out
  })

/** Serves the caller's feed for a feed token. Unknown tokens are NotFound. */
export const icalFeed = Command.make("ical.feed", {
  input: Schema.Struct({ token: Schema.String }),
  output: Schema.String,
  authorize: () => Effect.void,
  run: ({ token }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [profile] = yield* db
        .select({ userId: userProfiles.userId })
        .from(userProfiles)
        .where(eq(userProfiles.icalTokenHash, tokenHash(token)))
        .limit(1)
      if (!profile) return yield* Effect.fail(new NotFound({ entity: "ical_feed", id: "token" }))
      const components = yield* feedEvents(profile.userId as UserId)
      return renderIcs(components, new Date())
    }),
})
