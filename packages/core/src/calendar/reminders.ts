/**
 * Event reminders. Each (series, minutes before, occurrence) has at most one queued job, keyed by
 * a singleton key. A job re-checks that its occurrence is still the next effective start before it
 * notifies, so edits and deletes invalidate queued jobs without needing to find them.
 */
import { entities, eventAttendees, eventReminders, events, notifications } from "@audit/db/schema"
import type { EventId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { defineJob, Jobs } from "@audit/platform/jobs"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { notify } from "../notifications/notify.ts"
import { nextOccurrence } from "./recurrence.ts"

const MINUTE = 60 * 1000
const MAX_SKIPPED_OCCURRENCES = 50

export const ReminderData = Schema.Struct({
  eventId: Schema.String,
  startsAt: Schema.String,
  minutesBefore: Schema.Number,
})

export const calendarReminderJob = defineJob("calendar.reminder", ReminderData)

/** The series row when it and its entity are live. */
const liveSeries = (seriesId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ event: events })
      .from(events)
      .innerJoin(entities, eq(entities.id, events.id))
      .where(and(eq(events.id, seriesId), isNull(entities.deletedAt)))
      .limit(1)
    return row?.event ?? null
  })

const liveOverrides = (seriesId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ event: events })
      .from(events)
      .innerJoin(entities, eq(entities.id, events.id))
      .where(and(eq(events.recurrenceParentId, seriesId), isNull(entities.deletedAt)))
    return rows.map((r) => r.event)
  })

/**
 * The earliest effective start (override-aware, exdate-aware) of a series strictly after `after`,
 * or null when none is scheduled.
 */
export const nextEffectiveStart = (seriesId: EventId, after: Date) =>
  Effect.gen(function* () {
    const series = yield* liveSeries(seriesId)
    if (!series) return null
    const overrides = yield* liveOverrides(seriesId)
    const timing = {
      startsAt: series.startsAt,
      endsAt: series.endsAt,
      timezone: series.timezone,
      rrule: series.rrule,
      exdates: series.exdates,
    }
    let candidate: Date | null = null
    let cursor = after
    for (let i = 0; i < MAX_SKIPPED_OCCURRENCES; i++) {
      const occurrence = nextOccurrence(timing, cursor)
      if (occurrence === null) break
      const override = overrides.find((o) => o.originalStart?.getTime() === occurrence.getTime())
      if (!override) {
        candidate = occurrence
        break
      }
      if (override.startsAt.getTime() > after.getTime()) {
        candidate = override.startsAt
        break
      }
      cursor = occurrence
    }
    for (const override of overrides) {
      if (override.startsAt.getTime() <= after.getTime()) continue
      if (candidate === null || override.startsAt.getTime() < candidate.getTime())
        candidate = override.startsAt
    }
    return candidate
  })

/** Queues the next reminder of one minute offset whose fire time is after `boundary`. */
const scheduleMinute = (seriesId: EventId, minutes: number, boundary: Date) =>
  Effect.gen(function* () {
    const start = yield* nextEffectiveStart(
      seriesId,
      new Date(boundary.getTime() + minutes * MINUTE),
    )
    if (start === null) return
    const jobs = yield* Jobs
    const fireAt = new Date(start.getTime() - minutes * MINUTE)
    const now = new Date()
    yield* jobs.enqueue(
      calendarReminderJob,
      { eventId: seriesId, startsAt: start.toISOString(), minutesBefore: minutes },
      {
        startAfter: fireAt.getTime() > now.getTime() ? fireAt : now,
        singletonKey: `${seriesId}:${minutes}:${start.getTime()}`,
      },
    )
  })

/** Queues the next reminders for every reminder offset of a series, after now. */
export const scheduleReminders = (seriesId: EventId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ minutesBefore: eventReminders.minutesBefore })
      .from(eventReminders)
      .where(eq(eventReminders.eventId, seriesId))
    for (const row of rows) yield* scheduleMinute(seriesId, row.minutesBefore, new Date())
  })

export const calendarReminder = Command.make("calendar.reminder", {
  input: ReminderData,
  output: Schema.Void,
  authorize: () => Effect.void,
  run: (data) =>
    Effect.gen(function* () {
      const db = yield* Db
      const eventId = data.eventId as EventId
      const start = new Date(data.startsAt)
      const effective = yield* nextEffectiveStart(eventId, new Date(start.getTime() - 1))
      if (effective === null || effective.getTime() !== start.getTime()) return
      const [reminder] = yield* db
        .select({ minutesBefore: eventReminders.minutesBefore })
        .from(eventReminders)
        .where(
          and(
            eq(eventReminders.eventId, eventId),
            eq(eventReminders.minutesBefore, data.minutesBefore),
          ),
        )
        .limit(1)
      if (!reminder) return
      const [series] = yield* db
        .select({ title: entities.title, projectId: entities.projectId })
        .from(entities)
        .where(eq(entities.id, eventId))
        .limit(1)
      const attendees = yield* db
        .select({ principalId: eventAttendees.principalId })
        .from(eventAttendees)
        .where(and(eq(eventAttendees.eventId, eventId), eq(eventAttendees.principalType, "user")))
      for (const attendee of attendees) {
        if (attendee.principalId === null) continue
        const userId = attendee.principalId as UserId
        const groupKey = `event_reminder:${eventId}:${start.getTime()}:${data.minutesBefore}`
        const [sent] = yield* db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(notifications.userId, userId), eq(notifications.groupKey, groupKey)))
          .limit(1)
        if (sent) continue
        yield* notify({
          userId,
          kind: "event_reminder",
          entityId: eventId,
          projectId: (series?.projectId ?? null) as ProjectId | null,
          actorId: null,
          payload: {
            title: series?.title ?? "",
            startsAt: data.startsAt,
            minutesBefore: data.minutesBefore,
          },
          groupKey,
        })
      }
      yield* scheduleMinute(eventId, data.minutesBefore, start)
    }),
})
