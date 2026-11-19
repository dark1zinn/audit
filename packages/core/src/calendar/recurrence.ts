/**
 * Pure recurrence helpers. A series stores its RRULE without DTSTART; DTSTART is the series
 * `startsAt` read in the event's IANA timezone, so wall-clock times survive DST changes.
 */
import { RRuleTemporal } from "rrule-temporal"

export interface SeriesTiming {
  readonly startsAt: Date
  readonly endsAt: Date
  readonly timezone: string
  readonly rrule: string | null
  readonly exdates: ReadonlyArray<Date>
}

const zoned = (date: Date, timezone: string) =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timezone)

/** Returns the rule with `UNTIL` set to `until` and any `COUNT` dropped. */
export const withUntil = (rrule: string, until: Date): string =>
  [
    ...rrule.split(";").filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT=")),
    `UNTIL=${until
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "")}`,
  ].join(";")

export const withCount = (rrule: string, count: number): string =>
  [
    ...rrule.split(";").filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT=")),
    `COUNT=${count}`,
  ].join(";")

/** Throws `RangeError` for an invalid rule; callers validate at the boundary. */
export const parseRule = (rrule: string, timing: SeriesTiming) =>
  new RRuleTemporal({
    rruleString: rrule,
    dtstart: zoned(timing.startsAt, timing.timezone),
    temporal: Temporal,
  })

/** Occurrence starts (as epoch ms) of a series whose occurrence overlaps [from, to). */
export const occurrenceStarts = (
  timing: SeriesTiming,
  from: Date,
  to: Date,
): ReadonlyArray<Date> => {
  const duration = timing.endsAt.getTime() - timing.startsAt.getTime()
  const excluded = new Set(timing.exdates.map((d) => d.getTime()))
  if (timing.rrule === null) {
    return timing.startsAt.getTime() < to.getTime() &&
      timing.endsAt.getTime() > from.getTime() &&
      !excluded.has(timing.startsAt.getTime())
      ? [timing.startsAt]
      : []
  }
  const rule = parseRule(timing.rrule, timing)
  const after = zoned(new Date(from.getTime() - duration - 1), timing.timezone)
  const before = zoned(to, timing.timezone)
  return rule
    .between(after, before, false)
    .map((zdt) => new Date(zdt.epochMilliseconds))
    .filter((start) => !excluded.has(start.getTime()))
}

/** Number of occurrences starting strictly before `before`. */
export const countBefore = (timing: SeriesTiming, before: Date): number => {
  if (timing.rrule === null) return timing.startsAt.getTime() < before.getTime() ? 1 : 0
  const rule = parseRule(timing.rrule, timing)
  const start = zoned(new Date(timing.startsAt.getTime() - 1), timing.timezone)
  return rule
    .between(start, zoned(before, timing.timezone), false)
    .filter((zdt) => zdt.epochMilliseconds < before.getTime()).length
}

/** The first occurrence start strictly after `after`, or null when the series has ended. */
export const nextOccurrence = (timing: SeriesTiming, after: Date): Date | null => {
  const horizon = new Date(after.getTime() + 366 * 24 * 60 * 60 * 1000 * 10)
  const starts = occurrenceStarts({ ...timing, endsAt: timing.startsAt }, after, horizon).filter(
    (start) => start.getTime() > after.getTime(),
  )
  return starts[0] ?? null
}

/** Validates an RRULE string (frequency required, parseable) with a dummy timing. */
export const isValidRule = (rrule: string): boolean => {
  if (!rrule.startsWith("FREQ=")) return false
  try {
    parseRule(rrule, {
      startsAt: new Date(0),
      endsAt: new Date(0),
      timezone: "UTC",
      rrule: null,
      exdates: [],
    })
    return true
  } catch {
    return false
  }
}
