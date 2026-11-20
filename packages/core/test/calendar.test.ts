import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  createCalendar,
  createEvent,
  deleteEvent,
  importIcs,
  regenerateIcalFeed,
  rsvp,
  updateEvent,
} from "@audit/core/calendar/commands"
import { calendarReminder, calendarReminderJob } from "@audit/core/calendar/reminders"
import { icalFeed, listEvents } from "@audit/core/calendar/queries"
import type { CalendarId, EventId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { renderIcs, type IcsEvent } from "@audit/core/calendar/ics"

let database: TestDatabase
let owner: Person
let bob: Person
let carol: Person
let calendarId: CalendarId

const WINDOW = { from: "2026-02-20T00:00:00Z", to: "2026-04-01T00:00:00Z" }

const listAs = (person: Person, range = WINDOW) =>
  runAs(database, person.actor)(listEvents.execute(range))

/** Version of the series row: every non-override occurrence carries it. */
const seriesVersion = async (person: Person, seriesId: EventId) => {
  const occ = await listAs(person)
  const series = occ.find((o) => o.eventId === seriesId && !o.isOverride)
  if (!series) throw new Error("series occurrence not visible")
  return series.version
}

const starts = (occ: ReadonlyArray<{ startsAt: Date }>) => occ.map((o) => o.startsAt.toISOString())

const seriesInput = (overrides: Partial<Record<string, unknown>> = {}) => ({
  calendarId,
  title: "Standup",
  startsAt: new Date("2026-03-01T15:00:00Z"),
  endsAt: new Date("2026-03-01T15:30:00Z"),
  allDay: false,
  timezone: "America/New_York",
  rrule: "FREQ=WEEKLY;COUNT=4",
  location: "",
  description: null,
  attendees: [],
  reminders: [],
  ...overrides,
})

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  bob = await addPerson(database, owner, "Bob", "member")
  carol = await addPerson(database, owner, "Carol", "member")
  const cal = await runAs(
    database,
    owner.actor,
  )(createCalendar.execute({ name: "Work", color: "#336699", teamId: null }))
  calendarId = cal.id
}, 120_000)

afterAll(() => database.drop())

describe("calendar recurrence", () => {
  test("weekly events keep local wall-clock time across the US DST change", async () => {
    await runAs(database, owner.actor)(createEvent.execute(seriesInput()))
    const occ = await listAs(owner)
    expect(starts(occ)).toEqual([
      "2026-03-01T15:00:00.000Z",
      "2026-03-08T14:00:00.000Z",
      "2026-03-15T14:00:00.000Z",
      "2026-03-22T14:00:00.000Z",
    ])
  })

  test("scope this overrides one occurrence and leaves the rest of the series alone", async () => {
    const occ = await listAs(owner)
    const seriesId = occ[0]!.eventId
    const target = occ.find((o) => o.startsAt.toISOString() === "2026-03-08T14:00:00.000Z")!
    await runAs(
      database,
      owner.actor,
    )(
      updateEvent.execute({
        eventId: target.eventId,
        patch: {
          scope: "this",
          occurrenceStart: target.occurrenceStart,
          startsAt: new Date("2026-03-08T16:00:00Z"),
          endsAt: new Date("2026-03-08T16:30:00Z"),
          version: target.version,
        },
      }),
    )
    const after = await listAs(owner)
    expect(starts(after)).toEqual([
      "2026-03-01T15:00:00.000Z",
      "2026-03-08T16:00:00.000Z",
      "2026-03-15T14:00:00.000Z",
      "2026-03-22T14:00:00.000Z",
    ])
    expect(
      after.find((o) => o.startsAt.toISOString() === "2026-03-08T16:00:00.000Z")!.isOverride,
    ).toBe(true)
    expect(seriesId).toBe(after[0]!.eventId)
  })

  test("scope following truncates the series at the chosen occurrence", async () => {
    const occ = await listAs(owner)
    const seriesId = occ[0]!.eventId
    const version = await seriesVersion(owner, seriesId)
    const cut = occ.find((o) => o.startsAt.toISOString() === "2026-03-15T14:00:00.000Z")!
    await runAs(
      database,
      owner.actor,
    )(
      deleteEvent.execute({
        eventId: cut.eventId,
        patch: { scope: "following", occurrenceStart: cut.occurrenceStart, version },
      }),
    )
    const after = await listAs(owner)
    expect(starts(after)).toEqual(["2026-03-01T15:00:00.000Z", "2026-03-08T16:00:00.000Z"])
  })
})

describe("calendar visibility", () => {
  test("a person without calendar access sees no occurrences", async () => {
    const seen = await listAs(bob)
    expect(seen).toEqual([])
  })

  test("the ICS feed of a person without access carries none of the owner's events", async () => {
    const url = (await runAs(database, bob.actor)(regenerateIcalFeed.execute({}))).url
    const token = url.split("/ical/")[1]!.replace(".ics", "")
    const body = await runAs(database, { _tag: "system", reason: "ical-feed" })(
      icalFeed.execute({ token }),
    )
    expect(body).not.toContain("Standup")
  })

  test("the owner's ICS feed contains the owner's events", async () => {
    const url = (await runAs(database, owner.actor)(regenerateIcalFeed.execute({}))).url
    const token = url.split("/ical/")[1]!.replace(".ics", "")
    const body = await runAs(database, { _tag: "system", reason: "ical-feed" })(
      icalFeed.execute({ token }),
    )
    expect(body).toContain("BEGIN:VEVENT")
    expect(body).toContain("Standup")
  })
})

describe("RSVP", () => {
  test("only an invitee can respond; a non-invitee is refused", async () => {
    const eventId = (await listAs(owner))[0]!.eventId
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          title: "Review",
          startsAt: new Date("2026-03-05T10:00:00Z"),
          endsAt: new Date("2026-03-05T11:00:00Z"),
          timezone: "UTC",
          rrule: null,
          attendees: [{ principalType: "user", principalId: carol.userId }],
        }),
      ),
    )
    const review = (await listAs(owner)).find((o) => o.title === "Review")!
    expect(review.eventId).not.toBe(eventId)
    await runAs(
      database,
      carol.actor,
    )(rsvp.execute({ eventId: review.eventId, response: "accepted" }))
    const refused = await exitAs(
      database,
      bob.actor,
    )(rsvp.execute({ eventId: review.eventId, response: "accepted" }))
    expect(refused._tag).toBe("Failure")
  })
})

describe("ICS import and reminders", () => {
  test("importing an ICS document creates the events it contains", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:imported-1@test",
      "DTSTAMP:20260301T000000Z",
      "DTSTART:20260310T100000Z",
      "DTEND:20260310T110000Z",
      "SUMMARY:Imported",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n")
    const result = await runAs(database, owner.actor)(importIcs.execute({ calendarId, ics }))
    expect(result.imported).toBe(1)
    const occ = await listAs(owner)
    expect(occ.map((o) => o.title)).toContain("Imported")
  })

  test("creating an event with a reminder queues a reminder job", async () => {
    const before = database.jobs.enqueued.filter((j) => j.name === calendarReminderJob.name).length
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          title: "Remind me",
          startsAt: new Date("2027-06-10T10:00:00Z"),
          endsAt: new Date("2027-06-10T11:00:00Z"),
          timezone: "UTC",
          rrule: null,
          reminders: [15],
        }),
      ),
    )
    const after = database.jobs.enqueued.filter((j) => j.name === calendarReminderJob.name).length
    expect(after).toBeGreaterThan(before)
  })
})

const newCalendar = async (name: string) =>
  (
    await runAs(
      database,
      owner.actor,
    )(createCalendar.execute({ name, color: "#336699", teamId: null }))
  ).id

const inCalendar = async (cal: CalendarId, from: string, to: string) =>
  (await listAs(owner, { from, to })).filter((o) => o.calendarId === cal)

const keyOf = (o: {
  startsAt: Date
  endsAt: Date
  title: string
  allDay: boolean
  isOverride: boolean
}) => `${o.startsAt.toISOString()}|${o.endsAt.toISOString()}|${o.title}|${o.allDay}|${o.isOverride}`

/** VEVENT components of an iCal body, as lists of content lines. */
const components = (body: string) =>
  body
    .split("BEGIN:VEVENT\r\n")
    .slice(1)
    .map((block) => block.split("END:VEVENT")[0]!.split("\r\n"))

const feedBody = async (person: Person) => {
  const url = (await runAs(database, person.actor)(regenerateIcalFeed.execute({}))).url
  const token = url.split("/ical/")[1]!.replace(".ics", "")
  return runAs(database, { _tag: "system", reason: "ical-feed" })(icalFeed.execute({ token }))
}

describe("calendar scope and deletion", () => {
  test("scope all shifts the series and keeps overrides consistent", async () => {
    const cal = await newCalendar("Scope all")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: cal,
          title: "Scope all",
          startsAt: new Date("2026-03-02T14:00:00Z"),
          endsAt: new Date("2026-03-02T14:30:00Z"),
        }),
      ),
    )
    const before = await inCalendar(cal, WINDOW.from, WINDOW.to)
    const mar9 = before.find((o) => o.startsAt.toISOString() === "2026-03-09T13:00:00.000Z")!
    await runAs(
      database,
      owner.actor,
    )(
      updateEvent.execute({
        eventId: mar9.eventId,
        patch: {
          scope: "this",
          occurrenceStart: mar9.occurrenceStart,
          startsAt: new Date("2026-03-09T16:00:00Z"),
          endsAt: new Date("2026-03-09T16:30:00Z"),
          version: mar9.version,
        },
      }),
    )
    const first = before[0]!
    await runAs(
      database,
      owner.actor,
    )(
      updateEvent.execute({
        eventId: first.eventId,
        patch: {
          scope: "all",
          occurrenceStart: first.occurrenceStart,
          startsAt: new Date("2026-03-02T15:00:00Z"),
          endsAt: new Date("2026-03-02T15:30:00Z"),
          version: await seriesVersion(owner, first.eventId),
        },
      }),
    )
    const after = await inCalendar(cal, WINDOW.from, WINDOW.to)
    expect(starts(after)).toEqual([
      "2026-03-02T15:00:00.000Z",
      "2026-03-09T16:00:00.000Z",
      "2026-03-16T14:00:00.000Z",
      "2026-03-23T14:00:00.000Z",
    ])
    expect(after.map((o) => o.isOverride)).toEqual([false, true, false, false])
  })

  test("scope this deletion adds an exdate and removes only that occurrence", async () => {
    const cal = await newCalendar("Delete this")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: cal,
          title: "Daily",
          startsAt: new Date("2026-03-02T12:00:00Z"),
          endsAt: new Date("2026-03-02T12:30:00Z"),
          timezone: "UTC",
          rrule: "FREQ=DAILY;COUNT=5",
        }),
      ),
    )
    const range = { from: "2026-03-01T00:00:00Z", to: "2026-03-10T00:00:00Z" }
    const occ = await inCalendar(cal, range.from, range.to)
    const mar4 = occ.find((o) => o.startsAt.toISOString() === "2026-03-04T12:00:00.000Z")!
    await runAs(
      database,
      owner.actor,
    )(
      deleteEvent.execute({
        eventId: mar4.eventId,
        patch: { scope: "this", occurrenceStart: mar4.occurrenceStart, version: mar4.version },
      }),
    )
    const after = await inCalendar(cal, range.from, range.to)
    expect(starts(after)).toEqual([
      "2026-03-02T12:00:00.000Z",
      "2026-03-03T12:00:00.000Z",
      "2026-03-05T12:00:00.000Z",
      "2026-03-06T12:00:00.000Z",
    ])
  })

  test("the feed exports the series with RRULE and EXDATE plus its override", async () => {
    const cal = await newCalendar("Feed")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: cal,
          title: "Feed series",
          startsAt: new Date("2026-03-02T14:00:00Z"),
          endsAt: new Date("2026-03-02T14:30:00Z"),
        }),
      ),
    )
    const occ = await inCalendar(cal, WINDOW.from, WINDOW.to)
    const mar9 = occ.find((o) => o.startsAt.toISOString() === "2026-03-09T13:00:00.000Z")!
    await runAs(
      database,
      owner.actor,
    )(
      deleteEvent.execute({
        eventId: mar9.eventId,
        patch: { scope: "this", occurrenceStart: mar9.occurrenceStart, version: mar9.version },
      }),
    )
    const mar16 = (await inCalendar(cal, WINDOW.from, WINDOW.to)).find(
      (o) => o.startsAt.toISOString() === "2026-03-16T13:00:00.000Z",
    )!
    await runAs(
      database,
      owner.actor,
    )(
      updateEvent.execute({
        eventId: mar16.eventId,
        patch: {
          scope: "this",
          occurrenceStart: mar16.occurrenceStart,
          startsAt: new Date("2026-03-16T17:00:00Z"),
          endsAt: new Date("2026-03-16T17:30:00Z"),
          version: mar16.version,
        },
      }),
    )
    const body = await feedBody(owner)
    const uid = `${occ[0]!.eventId}@audit`
    const parts = components(body).filter((lines) => lines.includes(`UID:${uid}`))
    expect(parts).toHaveLength(2)
    const [master, override] = parts as [string[], string[]]
    expect(master).toContain("DTSTART;TZID=America/New_York:20260302T090000")
    expect(master).toContain("RRULE:FREQ=WEEKLY;COUNT=4")
    expect(master).toContain("EXDATE;TZID=America/New_York:20260309T090000")
    expect(override).toContain("RECURRENCE-ID;TZID=America/New_York:20260316T090000")
    expect(override).toContain("DTSTART;TZID=America/New_York:20260316T130000")
  })

  test("export then import reproduces three months of occurrences", async () => {
    const src = await newCalendar("Round trip source")
    const dst = await newCalendar("Round trip target")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: src,
          title: "RT series",
          startsAt: new Date("2026-03-02T14:00:00Z"),
          endsAt: new Date("2026-03-02T14:30:00Z"),
          rrule: "FREQ=WEEKLY;COUNT=12",
        }),
      ),
    )
    const range = { from: "2026-03-01T00:00:00Z", to: "2026-06-01T00:00:00Z" }
    const apr6 = (await inCalendar(src, range.from, range.to)).find(
      (o) => o.startsAt.toISOString() === "2026-04-06T13:00:00.000Z",
    )!
    await runAs(
      database,
      owner.actor,
    )(
      deleteEvent.execute({
        eventId: apr6.eventId,
        patch: { scope: "this", occurrenceStart: apr6.occurrenceStart, version: apr6.version },
      }),
    )
    const mar23 = (await inCalendar(src, range.from, range.to)).find(
      (o) => o.startsAt.toISOString() === "2026-03-23T13:00:00.000Z",
    )!
    await runAs(
      database,
      owner.actor,
    )(
      updateEvent.execute({
        eventId: mar23.eventId,
        patch: {
          scope: "this",
          occurrenceStart: mar23.occurrenceStart,
          title: "RT moved",
          startsAt: new Date("2026-03-24T15:00:00Z"),
          endsAt: new Date("2026-03-24T15:30:00Z"),
          version: mar23.version,
        },
      }),
    )
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: src,
          title: "RT allday",
          startsAt: new Date("2026-04-10T00:00:00Z"),
          endsAt: new Date("2026-04-11T00:00:00Z"),
          allDay: true,
          timezone: "UTC",
          rrule: null,
        }),
      ),
    )
    const ics = await feedBody(owner)
    await runAs(database, owner.actor)(importIcs.execute({ calendarId: dst, ics }))
    const keys = async (cal: CalendarId) =>
      (await inCalendar(cal, range.from, range.to)).map(keyOf).filter((k) => k.includes("|RT "))
    const source = await keys(src)
    expect(source).toHaveLength(12)
    expect(await keys(dst)).toEqual(source)
  })
})

describe("calendar time zones and reminders", () => {
  test("a daily series in Europe/Berlin keeps 09:00 local across the 2026 DST change", async () => {
    const cal = await newCalendar("Berlin")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: cal,
          title: "Berlin daily",
          startsAt: new Date("2026-03-27T08:00:00Z"),
          endsAt: new Date("2026-03-27T08:30:00Z"),
          timezone: "Europe/Berlin",
          rrule: "FREQ=DAILY;COUNT=5",
        }),
      ),
    )
    const occ = await inCalendar(cal, "2026-03-26T00:00:00Z", "2026-04-01T00:00:00Z")
    expect(starts(occ)).toEqual([
      "2026-03-27T08:00:00.000Z",
      "2026-03-28T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
      "2026-03-31T07:00:00.000Z",
    ])
  })

  test("a reminder job run twice notifies each occurrence once", async () => {
    const cal = await newCalendar("Reminders")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: cal,
          title: "Reminded",
          startsAt: new Date("2026-05-01T09:00:00Z"),
          endsAt: new Date("2026-05-01T09:30:00Z"),
          timezone: "UTC",
          rrule: "FREQ=DAILY;COUNT=3",
          reminders: [15],
          attendees: [{ principalType: "user", principalId: owner.userId }],
        }),
      ),
    )
    const eventId = (await inCalendar(cal, "2026-05-01T00:00:00Z", "2026-05-04T00:00:00Z"))[0]!
      .eventId
    const run = (startsAt: string) =>
      runAs(database, { _tag: "system", reason: "reminder-job" })(
        calendarReminder.execute({ eventId, startsAt, minutesBefore: 15 }),
      )
    await run("2026-05-01T09:00:00.000Z")
    await run("2026-05-01T09:00:00.000Z")
    await run("2026-05-02T09:00:00.000Z")
    const rows = await database.superuser`
      SELECT payload->>'count' AS count FROM notifications
      WHERE kind = 'event_reminder' AND user_id = ${owner.userId}`
    expect(rows.map((r: { count: string }) => r.count)).toEqual(["1", "1"])
  })

  test("a user without calendar access gets no VEVENTs for a private calendar", async () => {
    const cal = await newCalendar("Private")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: cal,
          title: "Private dentist",
          startsAt: new Date("2026-05-05T10:00:00Z"),
          endsAt: new Date("2026-05-05T11:00:00Z"),
          timezone: "UTC",
          rrule: "FREQ=DAILY;COUNT=2",
        }),
      ),
    )
    const body = await feedBody(bob)
    expect(body).not.toContain("BEGIN:VEVENT")
    expect(body).not.toContain("Private dentist")
  })
})

describe("invitee access", () => {
  test("an invitee sees, RSVPs to, is notified about, and loses an event in a hidden calendar", async () => {
    const dana = await addPerson(database, owner, "Dana", "member")
    const cal = await newCalendar("Invitee calendar")
    await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute(
        seriesInput({
          calendarId: cal,
          title: "Invited",
          startsAt: new Date("2026-05-10T09:00:00Z"),
          endsAt: new Date("2026-05-10T09:30:00Z"),
          timezone: "UTC",
          rrule: "FREQ=DAILY;COUNT=2",
          reminders: [15],
          attendees: [{ principalType: "user", principalId: dana.userId }],
        }),
      ),
    )
    const range = { from: "2026-05-09T00:00:00Z", to: "2026-05-12T00:00:00Z" }
    const invited = async () => (await listAs(dana, range)).filter((o) => o.title === "Invited")

    const seen = await invited()
    expect(starts(seen)).toEqual(["2026-05-10T09:00:00.000Z", "2026-05-11T09:00:00.000Z"])
    expect(await feedBody(dana)).toContain("Invited")

    const series = seen[0]!
    await runAs(
      database,
      dana.actor,
    )(rsvp.execute({ eventId: series.eventId, response: "accepted" }))

    const invites = await database.superuser`
      SELECT kind FROM notifications WHERE kind = 'event_invited' AND user_id = ${dana.userId}`
    expect(invites).toHaveLength(1)

    await runAs(database, { _tag: "system", reason: "reminder-job" })(
      calendarReminder.execute({
        eventId: series.eventId,
        startsAt: "2026-05-10T09:00:00.000Z",
        minutesBefore: 15,
      }),
    )
    const reminders = await database.superuser`
      SELECT 1 FROM notifications WHERE kind = 'event_reminder' AND user_id = ${dana.userId}`
    expect(reminders).toHaveLength(1)

    await runAs(
      database,
      owner.actor,
    )(
      updateEvent.execute({
        eventId: series.eventId,
        patch: {
          scope: "all",
          occurrenceStart: series.occurrenceStart,
          attendees: [],
          version: series.version,
        },
      }),
    )
    expect(await invited()).toEqual([])
    expect(await feedBody(dana)).not.toContain("Invited")
    const refused = await exitAs(
      database,
      dana.actor,
    )(rsvp.execute({ eventId: series.eventId, response: "declined" }))
    expect(refused._tag).toBe("Failure")
  })
})

describe("ICS output escaping", () => {
  const base: IcsEvent = {
    uid: "series-1@audit",
    title: "Standup",
    location: "",
    allDay: false,
    timezone: "UTC",
    startsAt: new Date("2026-03-02T09:00:00Z"),
    endsAt: new Date("2026-03-02T09:30:00Z"),
    rrule: "FREQ=DAILY;COUNT=3",
    exdates: [],
    recurrence: null,
  }
  const render = (overrides: Partial<IcsEvent>) =>
    renderIcs([{ ...base, ...overrides }], new Date("2026-01-01T00:00:00Z"))
  // Unfolds continuation lines, then splits into content lines.
  const lines = (body: string) => body.replace(/\r\n /g, "").split("\r\n")

  test("a title with CR, LF or semicolons is escaped and adds no property line", () => {
    const body = render({ title: "Team\rATTENDEE:mailto:x@evil\r\nLOCATION:evil;ok\\n,end" })
    const content = lines(body)
    expect(content).toContain(
      "SUMMARY:Team\\nATTENDEE:mailto:x@evil\\nLOCATION:evil\\;ok\\\\n\\,end",
    )
    expect(content.some((l) => l.startsWith("ATTENDEE"))).toBe(false)
    expect(content.some((l) => l.startsWith("LOCATION"))).toBe(false)
    expect(body).not.toMatch(/\r(?!\n)/)
  })

  test("a location with a lone CR cannot break the content line", () => {
    const content = lines(render({ location: "Room 1\rX-EVIL:1" }))
    expect(content).toContain("LOCATION:Room 1\\nX-EVIL:1")
    expect(content.some((l) => l.startsWith("X-EVIL"))).toBe(false)
  })

  test("an RRULE containing a newline or a foreign property is not emitted", () => {
    const injected = lines(render({ rrule: "FREQ=DAILY;COUNT=3\r\nATTENDEE:mailto:x@evil" }))
    expect(injected.some((l) => l.startsWith("RRULE"))).toBe(false)
    expect(injected.some((l) => l.startsWith("ATTENDEE"))).toBe(false)
    expect(injected).toContain("SUMMARY:Standup")
    const spaced = lines(render({ rrule: "FREQ=DAILY;COUNT=3 X=1" }))
    expect(spaced.some((l) => l.startsWith("RRULE"))).toBe(false)
    expect(lines(render({ rrule: "BYDAY=MO" })).some((l) => l.startsWith("RRULE"))).toBe(false)
  })

  test("a valid weekly or monthly rule is emitted unchanged", () => {
    const weekly = "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z"
    const monthly = "FREQ=MONTHLY;BYDAY=+1MO;COUNT=6"
    const lastDay = "FREQ=MONTHLY;BYMONTHDAY=-1;INTERVAL=2"
    expect(lines(render({ rrule: weekly }))).toContain(`RRULE:${weekly}`)
    expect(lines(render({ rrule: monthly }))).toContain(`RRULE:${monthly}`)
    expect(lines(render({ rrule: lastDay }))).toContain(`RRULE:${lastDay}`)
    expect(lines(render({ rrule: "FREQ=weekly;BYDAY=mo" }))).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO")
  })
})

describe("event description on update", () => {
  test("an update with a description the editor schema refuses is refused", async () => {
    await runAs(
      database,
      owner.actor,
    )(createEvent.execute(seriesInput({ rrule: null, title: "Solo" })))
    const solo = (await listAs(owner)).find((o) => o.title === "Solo")!
    const refused = await exitAs(
      database,
      owner.actor,
    )(
      updateEvent.execute({
        eventId: solo.eventId,
        patch: {
          scope: "all",
          description: { type: "rawHtml", attrs: {} },
          version: solo.version,
        },
      }),
    )
    expect(refused._tag).toBe("Failure")
  })
})
