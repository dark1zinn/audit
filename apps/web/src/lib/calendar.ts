import { Temporal } from "temporal-polyfill"
import type { EventOccurrence } from "@audit/domain/calendar/schema"
import type { CalendarItem } from "@audit/domain/tasks/schema"

/** Stable identity of one occurrence: its event plus the un-overridden series start. */
export const occurrenceKey = (occurrence: EventOccurrence): string =>
  `${occurrence.eventId}|${occurrence.occurrenceStart.toISOString()}`

const pad = (value: number) => String(value).padStart(2, "0")

/** Local calendar date (`YYYY-MM-DD`) of an instant in a time zone. */
export const localDate = (instant: Date, timeZone: string): string =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString()

/** Local wall-clock `date` (`YYYY-MM-DD`) and `time` (`HH:MM`) of an instant in a time zone. */
export const toWall = (instant: Date, timeZone: string): { date: string; time: string } => {
  const zoned = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(
    timeZone,
  )
  return {
    date: zoned.toPlainDate().toString(),
    time: `${pad(zoned.hour)}:${pad(zoned.minute)}`,
  }
}

/** Instant for a wall-clock date and time in a time zone. Returns `undefined` if out of range. */
export const fromWall = (date: string, time: string, timeZone: string): Date | undefined => {
  try {
    const instant = Temporal.PlainDateTime.from(`${date}T${time}`)
      .toZonedDateTime(timeZone)
      .toInstant()
    return new Date(instant.epochMilliseconds)
  } catch {
    return undefined
  }
}

/** All-day values are stored as UTC midnight of their calendar date. */
export const allDayInstant = (date: string): Date => new Date(`${date}T00:00:00Z`)

/** The calendar date of a stored all-day value. */
export const allDayDate = (instant: Date): string => instant.toISOString().slice(0, 10)

/** Adds whole days to a `YYYY-MM-DD` date. */
export const addDays = (date: string, days: number): string =>
  Temporal.PlainDate.from(date).add({ days }).toString()

/** Half-open instants of the Monday-start week containing `now` in a time zone. */
export const weekRange = (
  now: Date,
  timeZone: string,
): { readonly from: Date; readonly to: Date } => {
  const today = localDate(now, timeZone)
  const monday = addDays(today, 1 - Temporal.PlainDate.from(today).dayOfWeek)
  return {
    from: fromWall(monday, "00:00", timeZone) ?? now,
    to: fromWall(addDays(monday, 7), "00:00", timeZone) ?? now,
  }
}

/** Next day of an exclusive all-day end, as an inclusive date (never before the start). */
const lastDayOf = (startDate: string, endsAt: Date): string => {
  const exclusive = allDayDate(endsAt)
  const last = addDays(exclusive, -1)
  return last < startDate ? startDate : last
}

/** Shape of an event rendered by Schedule-X in this app. */
export interface CalendarDisplayEvent {
  readonly id: string
  readonly calendarId: string
  readonly title: string
  readonly start: Temporal.ZonedDateTime | Temporal.PlainDate
  readonly end: Temporal.ZonedDateTime | Temporal.PlainDate
  readonly location?: string
}

export const occurrenceToDisplay = (
  occurrence: EventOccurrence,
  timeZone: string,
): CalendarDisplayEvent => {
  const id = occurrenceKey(occurrence)
  if (occurrence.allDay) {
    const startDate = allDayDate(occurrence.startsAt)
    return {
      id,
      calendarId: occurrence.calendarId,
      title: occurrence.title,
      start: Temporal.PlainDate.from(startDate),
      end: Temporal.PlainDate.from(lastDayOf(startDate, occurrence.endsAt)),
      location: occurrence.location,
    }
  }
  const start = Temporal.Instant.fromEpochMilliseconds(
    occurrence.startsAt.getTime(),
  ).toZonedDateTimeISO(timeZone)
  const end = Temporal.Instant.fromEpochMilliseconds(
    occurrence.endsAt.getTime(),
  ).toZonedDateTimeISO(timeZone)
  return {
    id,
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    start,
    end: Temporal.ZonedDateTime.compare(end, start) < 0 ? start : end,
    location: occurrence.location,
  }
}

/** A task due date shown as an all-day item in the calendar. */
export const dueToDisplay = (item: CalendarItem, timeZone: string, calendarId: string) => {
  const day = Temporal.PlainDate.from(localDate(item.dueAt, timeZone))
  return {
    id: `task:${item.id}`,
    calendarId,
    title: `${item.key} ${item.title}`,
    start: day,
    end: day,
  }
}

export const TIMEZONE_FALLBACK = "UTC"

/** IANA time zones for the picker, always including the current value. */
export const timeZoneOptions = (current: string): ReadonlyArray<string> => {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
  const set = new Set<string>([current, TIMEZONE_FALLBACK, ...supported])
  return [...set].toSorted((a, b) => a.localeCompare(b))
}

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const weekdayOf = (date: string): Weekday =>
  WEEKDAYS[Temporal.PlainDate.from(date).dayOfWeek - 1] ?? "MO"

export type RecurrenceFreq = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom"
export type RecurrenceEnd = "never" | "until" | "count"

/** Form state of the recurrence builder. `custom` keeps the raw RRULE text. */
export interface RecurrenceState {
  readonly freq: RecurrenceFreq
  readonly weekdays: ReadonlyArray<Weekday>
  readonly end: RecurrenceEnd
  readonly until: string
  readonly count: number
  readonly custom: string
}

export const defaultRecurrence = (startDate: string): RecurrenceState => ({
  freq: "none",
  weekdays: [weekdayOf(startDate)],
  end: "never",
  until: startDate,
  count: 10,
  custom: "",
})

const FREQ_BY_RRULE: Readonly<Record<string, RecurrenceFreq>> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
}

const ALLOWED_RRULE_KEYS: Readonly<Record<string, true>> = {
  FREQ: true,
  BYDAY: true,
  UNTIL: true,
  COUNT: true,
}

const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/

/**
 * Reads an RRULE into builder state. Anything the builder cannot express (INTERVAL, BYMONTHDAY,
 * ...) becomes `custom` so it round-trips unchanged.
 */
export const parseRecurrence = (
  rrule: string | null,
  timeZone: string,
  startDate: string,
): RecurrenceState => {
  const base = defaultRecurrence(startDate)
  if (rrule === null || rrule.trim() === "") return base
  const custom: RecurrenceState = { ...base, freq: "custom", custom: rrule }

  const parts = new Map<string, string>()
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=")
    if (eq <= 0) return custom
    parts.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1))
  }
  if ([...parts.keys()].some((key) => ALLOWED_RRULE_KEYS[key] !== true)) return custom
  if (parts.has("UNTIL") && parts.has("COUNT")) return custom

  const freq = FREQ_BY_RRULE[parts.get("FREQ") ?? ""]
  if (freq === undefined) return custom

  let weekdays: ReadonlyArray<Weekday> = base.weekdays
  if (parts.has("BYDAY")) {
    if (freq !== "weekly") return custom
    const days = (parts.get("BYDAY") ?? "").split(",")
    if (!days.every((day): day is Weekday => (WEEKDAYS as ReadonlyArray<string>).includes(day))) {
      return custom
    }
    weekdays = WEEKDAYS.filter((day) => days.includes(day))
  }

  let end: RecurrenceEnd = "never"
  let until = base.until
  let count = base.count
  if (parts.has("COUNT")) {
    const parsed = Number(parts.get("COUNT"))
    if (!Number.isInteger(parsed) || parsed < 1) return custom
    end = "count"
    count = parsed
  }
  if (parts.has("UNTIL")) {
    const match = UNTIL_PATTERN.exec(parts.get("UNTIL") ?? "")
    if (match === null) return custom
    const [, y, m, d, hh, mm, ss] = match
    const date = `${y}-${m}-${d}`
    try {
      if (hh !== undefined) {
        const instant = Temporal.Instant.from(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`)
        until = instant.toZonedDateTimeISO(timeZone).toPlainDate().toString()
      } else {
        until = Temporal.PlainDate.from(date).toString()
      }
    } catch {
      return custom
    }
    end = "until"
  }

  return { freq, weekdays, end, until, count, custom: "" }
}

/** Builds the RRULE for builder state. Returns `null` for non-recurring events. */
export const buildRrule = (
  state: RecurrenceState,
  timeZone: string,
  startDate: string,
): string | null => {
  if (state.freq === "none") return null
  if (state.freq === "custom") return state.custom.trim() === "" ? null : state.custom.trim()
  const parts = [`FREQ=${state.freq.toUpperCase()}`]
  if (state.freq === "weekly") {
    const days = WEEKDAYS.filter((day) => state.weekdays.includes(day))
    parts.push(`BYDAY=${(days.length > 0 ? days : [weekdayOf(startDate)]).join(",")}`)
  }
  if (state.end === "until") {
    const endOfDay = Temporal.PlainDate.from(state.until)
      .toPlainDateTime("23:59:59")
      .toZonedDateTime(timeZone)
      .toInstant()
    parts.push(`UNTIL=${endOfDay.toString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`)
  } else if (state.end === "count") {
    parts.push(`COUNT=${state.count}`)
  }
  return parts.join(";")
}

/** Hex colour with an alpha channel, for Schedule-X container backgrounds. */
export const tint = (color: string, alpha: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alpha}` : color
