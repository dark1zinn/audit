/**
 * Minimal iCalendar (RFC 5545) reader and writer for calendar import and the iCal feed.
 * The writer emits one VEVENT per series (DTSTART, RRULE, EXDATE) and one VEVENT per edited
 * occurrence (RECURRENCE-ID, same UID). Timed values use TZID with the event's IANA zone, UTC
 * values use the Z form, and all-day values use VALUE=DATE. The reader understands the same forms
 * plus RECURRENCE-ID overrides, so an exported feed imports back into the same occurrences.
 */

/** A series (`recurrence` null) or one edited occurrence of a series. */
export interface IcsEvent {
  readonly uid: string
  readonly title: string
  readonly location: string
  readonly allDay: boolean
  readonly timezone: string
  readonly startsAt: Date
  readonly endsAt: Date
  readonly rrule: string | null
  readonly exdates: ReadonlyArray<Date>
  /** For an override: the occurrence it replaces, expressed in the series' timing. */
  readonly recurrence: {
    readonly at: Date
    readonly timezone: string
    readonly allDay: boolean
  } | null
}

export interface ParsedEvent {
  readonly uid: string
  readonly title: string
  readonly startsAt: Date
  readonly endsAt: Date
  readonly allDay: boolean
  readonly timezone: string
  readonly location: string
  readonly rrule: string | null
  readonly exdates: ReadonlyArray<Date>
  /** Set on an override VEVENT: the original start of the occurrence it replaces. */
  readonly recurrenceId: Date | null
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0")

const utcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

/** Wall-clock stamp of `instant` in `timezone`, without a suffix (e.g. 20260301T100000). */
const localStamp = (instant: Date, timezone: string) => {
  const z = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(timezone)
  return `${pad(z.year, 4)}${pad(z.month)}${pad(z.day)}T${pad(z.hour)}${pad(z.minute)}${pad(z.second)}`
}

const timeParam = (allDay: boolean, timezone: string) =>
  allDay ? ";VALUE=DATE" : timezone === "UTC" ? "" : `;TZID=${oneLine(timezone)}`

const timeValue = (instant: Date, allDay: boolean, timezone: string) =>
  allDay
    ? `${instant.getUTCFullYear()}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}`
    : timezone === "UTC"
      ? utcStamp(instant)
      : localStamp(instant, timezone)

const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")

/** Removes CR and LF so a value can never end its content line early. */
const oneLine = (value: string) => value.replace(/[\r\n]/g, "")

/** RRULE values may use only these characters and must start with FREQ=; others are dropped. */
const isSafeRule = (rrule: string) => /^FREQ=[A-Z0-9=;,:+-]*$/.test(rrule)

const unescapeText = (value: string) =>
  value.replace(/\\(.)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c))

/**
 * Folds a content line so no physical line exceeds 75 octets; continuation lines start with a
 * space. Folding happens between code points so a multi-byte character is never split.
 */
const fold = (line: string) => {
  const out: string[] = []
  let chunk = ""
  let size = 0
  for (const ch of line) {
    const width = Buffer.byteLength(ch, "utf8")
    if (size + width > 75) {
      out.push(chunk)
      chunk = " "
      size = 1
    }
    chunk += ch
    size += width
  }
  out.push(chunk)
  return out.join("\r\n")
}

/** Renders series and overrides as one VCALENDAR. Non-cancelled rows only; the caller filters. */
export const renderIcs = (events: ReadonlyArray<IcsEvent>, now: Date): string => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//audit//calendar//EN",
    "CALSCALE:GREGORIAN",
  ]
  const stamp = utcStamp(now)
  for (const event of events) {
    const { allDay, timezone } = event
    lines.push("BEGIN:VEVENT", `UID:${oneLine(event.uid)}`, `DTSTAMP:${stamp}`)
    if (event.recurrence !== null) {
      const r = event.recurrence
      lines.push(
        `RECURRENCE-ID${timeParam(r.allDay, r.timezone)}:${timeValue(r.at, r.allDay, r.timezone)}`,
      )
    }
    lines.push(
      `DTSTART${timeParam(allDay, timezone)}:${timeValue(event.startsAt, allDay, timezone)}`,
      `DTEND${timeParam(allDay, timezone)}:${timeValue(event.endsAt, allDay, timezone)}`,
    )
    if (event.rrule !== null) {
      // Stored values may be lowercase (custom rules); RRULE keywords are uppercase on the wire.
      const upper = event.rrule.toUpperCase()
      // A VALUE=DATE series needs a DATE UNTIL, not a date-time.
      const rrule = allDay ? upper.replace(/UNTIL=(\d{8})T\d{6}Z/, "UNTIL=$1") : upper
      if (isSafeRule(rrule)) lines.push(`RRULE:${rrule}`)
    }
    if (event.exdates.length > 0) {
      const values = event.exdates.map((d) => timeValue(d, allDay, timezone)).join(",")
      lines.push(`EXDATE${timeParam(allDay, timezone)}:${values}`)
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`)
    if (event.location !== "") lines.push(`LOCATION:${escapeText(event.location)}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return `${lines.map(fold).join("\r\n")}\r\n`
}

interface IcsTime {
  readonly at: Date
  readonly allDay: boolean
}

/** Converts an iCal date or date-time value (optional TZID) to an instant. */
const parseTime = (value: string, tzid: string | null): IcsTime | null => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value)
  if (!m) return null
  const [, y, mo, d, h, mi, s = "00", z] = m
  if (h === undefined || mi === undefined) {
    return { at: new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))), allDay: true }
  }
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`
  if (z === "Z" || tzid === null) return { at: new Date(`${iso}Z`), allDay: false }
  try {
    const zoned = Temporal.PlainDateTime.from(iso).toZonedDateTime(tzid)
    return { at: new Date(zoned.epochMilliseconds), allDay: false }
  } catch {
    return null
  }
}

interface Pending {
  uid: string
  title: string
  location: string
  start: IcsTime | null
  startTz: string
  end: IcsTime | null
  rrule: string | null
  exdates: Date[]
  recurrenceId: IcsTime | null
}

const paramsOf = (name: string) => {
  const [key = "", ...params] = name.split(";")
  const tzParam = params.find((p) => p.toUpperCase().startsWith("TZID="))
  const tzid = tzParam ? tzParam.slice(5).replace(/^"(.*)"$/, "$1") : null
  return { key: key.toUpperCase(), tzid }
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const finish = (p: Pending): ParsedEvent | null => {
  if (p.start === null) return null
  const start = p.start
  const fallbackEnd = start.at.getTime() + (start.allDay ? DAY_MS : HOUR_MS)
  const endAt = p.end ? p.end.at.getTime() : fallbackEnd
  if (endAt < start.at.getTime()) return null
  return {
    uid: p.uid,
    title: p.title,
    startsAt: start.at,
    endsAt: new Date(endAt),
    allDay: start.allDay,
    timezone: start.allDay ? "UTC" : p.startTz,
    location: p.location,
    rrule: p.rrule,
    exdates: p.exdates,
    recurrenceId: p.recurrenceId?.at ?? null,
  }
}

/** Parses the VEVENTs of an iCalendar document. Malformed events are skipped. */
export const parseIcs = (text: string): ParsedEvent[] => {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)
  const out: ParsedEvent[] = []
  let current: Pending | null = null
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {
        uid: "",
        title: "",
        location: "",
        start: null,
        startTz: "UTC",
        end: null,
        rrule: null,
        exdates: [],
        recurrenceId: null,
      }
      continue
    }
    if (line === "END:VEVENT") {
      const parsed = current ? finish(current) : null
      if (parsed) out.push(parsed)
      current = null
      continue
    }
    if (current === null) continue
    const colon = line.indexOf(":")
    if (colon < 0) continue
    const { key, tzid } = paramsOf(line.slice(0, colon))
    const value = line.slice(colon + 1)
    if (key === "UID") current.uid = unescapeText(value)
    else if (key === "SUMMARY") current.title = unescapeText(value)
    else if (key === "LOCATION") current.location = unescapeText(value)
    else if (key === "RRULE") current.rrule = value
    else if (key === "RECURRENCE-ID") current.recurrenceId = parseTime(value, tzid)
    else if (key === "DTSTART" || key === "DTEND") {
      const time = parseTime(value, tzid)
      if (time === null) continue
      if (key === "DTSTART") {
        current.start = time
        current.startTz = tzid ?? "UTC"
      } else current.end = time
    } else if (key === "EXDATE") {
      for (const part of value.split(",")) {
        const time = parseTime(part, tzid)
        if (time) current.exdates.push(time.at)
      }
    }
  }
  return out
}
