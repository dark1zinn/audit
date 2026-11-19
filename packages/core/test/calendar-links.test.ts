import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as chat from "@audit/core/chat/commands"
import { createCalendar, createEvent, linkEvent, unlinkEvent } from "@audit/core/calendar/commands"
import { listCalendars, listEvents } from "@audit/core/calendar/queries"
import { createDoc } from "@audit/core/docs/commands"
import { createProject, grantProjectAccess } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { backlinks } from "@audit/core/references"
import { createTask } from "@audit/core/tasks/commands"
import type { BoardId, CalendarId, EntityId, EventId, ProjectId, TeamId } from "@audit/domain/ids"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"

let database: TestDatabase
let owner: Person
let mia: Person
let bob: Person
let sam: Person
let openProject: ProjectId
let hiddenProject: ProjectId
let lockProject: ProjectId
let openCalendar: CalendarId
let hiddenCalendar: CalendarId
let lockCalendar: CalendarId

const WINDOW = { from: "2026-05-01T00:00:00Z", to: "2026-07-01T00:00:00Z" }

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) =>
          typeof error === "object" && error !== null && "_tag" in error
            ? String(error._tag)
            : "unknown",
        ),
        Option.getOrElse(() => "defect"),
      )
    : "success"

const eventInput = (calendarId: CalendarId) => ({
  calendarId,
  title: "Review",
  startsAt: new Date("2026-06-10T15:00:00Z"),
  endsAt: new Date("2026-06-10T16:00:00Z"),
  allDay: false,
  timezone: "UTC",
  rrule: null,
  location: "",
  description: null,
  attendees: [],
  reminders: [],
})

const boardOf = async (projectId: ProjectId): Promise<BoardId> => {
  const boardId = await runAs(database, owner.actor)(defaultBoardId(projectId))
  if (boardId === null) throw new Error("project has no default board")
  return boardId
}

const newProject = (key: string, visibility: "workspace" | "restricted") =>
  runAs(
    database,
    owner.actor,
  )(createProject.execute({ key, name: key, visibility })).then(
    (project) => project.id as ProjectId,
  )

const newCalendar = (name: string, projectId: ProjectId) =>
  runAs(
    database,
    owner.actor,
  )(createCalendar.execute({ name, color: "#336699", projectId })).then(
    (calendar) => calendar.id as CalendarId,
  )

const occurrenceOf = async (person: Person, eventId: EventId) => {
  const occ = await runAs(database, person.actor)(listEvents.execute(WINDOW))
  const found = occ.find((o) => o.eventId === eventId)
  if (!found) throw new Error("event occurrence not visible")
  return found
}

const backlinkSources = async (person: Person, entityId: string) => {
  const groups = await runAs(database, person.actor)(backlinks(entityId as EntityId))
  return groups.flatMap((group) => group.items.map((item) => item.sourceId))
}

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  mia = await addPerson(database, owner, "Mia", "member")
  bob = await addPerson(database, owner, "Bob", "member")
  sam = await addPerson(database, owner, "Sam", "member")

  openProject = await newProject("OPEN", "workspace")
  hiddenProject = await newProject("HIDE", "restricted")
  lockProject = await newProject("LOCK", "restricted")

  const grant = (projectId: ProjectId, person: Person, role: "viewer" | "editor") =>
    runAs(
      database,
      owner.actor,
    )(
      grantProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: person.userId,
        role,
      }),
    )
  await grant(openProject, mia, "editor")
  await grant(hiddenProject, mia, "viewer")
  await grant(lockProject, bob, "viewer")

  openCalendar = await newCalendar("Open cal", openProject)
  hiddenCalendar = await newCalendar("Hidden cal", hiddenProject)
  lockCalendar = await newCalendar("Lock cal", lockProject)
}, 120_000)

afterAll(() => database.drop())

describe("project calendars", () => {
  test("a project calendar is visible only to project members", async () => {
    const calendarIdsFor = async (person: Person) =>
      (await runAs(database, person.actor)(listCalendars.execute({}))).map((c) => c.id)

    expect(await calendarIdsFor(mia)).toContain(hiddenCalendar)
    expect(await calendarIdsFor(sam)).not.toContain(hiddenCalendar)
    expect(await calendarIdsFor(sam)).toContain(openCalendar)
  })

  test("outsiders cannot create a calendar on a project they cannot edit", async () => {
    const exit = await exitAs(
      database,
      sam.actor,
    )(createCalendar.execute({ name: "Nope", color: "#000000", projectId: hiddenProject }))
    expect(failureTag(exit)).toBe("NotFound")
  })

  test("a calendar cannot belong to both a team and a project", async () => {
    const exit = await exitAs(
      database,
      owner.actor,
    )(
      createCalendar.execute({
        name: "Both",
        color: "#000000",
        teamId: Bun.randomUUIDv7() as TeamId,
        projectId: openProject,
      }),
    )
    expect(failureTag(exit)).toBe("ValidationError")
  })
})

describe("event links", () => {
  test("viewers cannot link items to an event", async () => {
    const event = await runAs(database, owner.actor)(createEvent.execute(eventInput(lockCalendar)))
    const task = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: await boardOf(lockProject), title: "Viewer target" }))
    const exit = await exitAs(
      database,
      bob.actor,
    )(linkEvent.execute({ eventId: event.eventId, kind: "task", targetId: task.id }))
    expect(failureTag(exit)).toBe("Forbidden")
  })

  test("editors link task, doc and thread; occurrences and backlinks reflect each link", async () => {
    const event = await runAs(database, owner.actor)(createEvent.execute(eventInput(openCalendar)))
    const task = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: await boardOf(openProject), title: "Ship calendar" }))
    const doc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: WORKSPACE_SPACE_ID as EntityId, title: "Agenda" }))
    const channel = await runAs(
      database,
      owner.actor,
    )(chat.createChannel.execute({ name: "links-room", kind: "public" }))
    const body = {
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    }
    const root = await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body }))

    await runAs(
      database,
      mia.actor,
    )(linkEvent.execute({ eventId: event.eventId, kind: "task", targetId: task.id }))
    await runAs(
      database,
      mia.actor,
    )(linkEvent.execute({ eventId: event.eventId, kind: "doc", targetId: doc.id }))
    await runAs(
      database,
      mia.actor,
    )(linkEvent.execute({ eventId: event.eventId, kind: "thread", targetId: root.id }))

    const linked = await occurrenceOf(owner, event.eventId)
    expect(linked.links).toEqual(
      expect.arrayContaining([
        { kind: "task", id: task.id, title: "Ship calendar", restricted: false },
        { kind: "doc", id: doc.id, title: "Agenda", restricted: false },
        { kind: "thread", id: root.id, title: expect.any(String), restricted: false },
      ]),
    )
    expect(await backlinkSources(owner, task.id)).toContain(event.eventId)

    await runAs(
      database,
      mia.actor,
    )(unlinkEvent.execute({ eventId: event.eventId, kind: "task", targetId: task.id }))
    const unlinked = await occurrenceOf(owner, event.eventId)
    expect(unlinked.links.map((l) => l.id)).not.toContain(task.id)
    expect(await backlinkSources(owner, task.id)).not.toContain(event.eventId)
  })

  test("items the viewer cannot read are restricted, with no title", async () => {
    const secret = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: await boardOf(hiddenProject), title: "Top secret" }))
    const event = await runAs(database, owner.actor)(createEvent.execute(eventInput(openCalendar)))
    await runAs(
      database,
      owner.actor,
    )(linkEvent.execute({ eventId: event.eventId, kind: "task", targetId: secret.id }))

    const seenByBob = await occurrenceOf(bob, event.eventId)
    expect(seenByBob.links).toEqual([
      { kind: "task", id: secret.id, title: null, restricted: true },
    ])
  })

  test("linking an item the actor cannot read fails with NotFound", async () => {
    const vault = await newProject("VAULT", "restricted")
    const secret = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId: await boardOf(vault), title: "Vault item" }))
    const event = await runAs(database, owner.actor)(createEvent.execute(eventInput(openCalendar)))
    const exit = await exitAs(
      database,
      mia.actor,
    )(linkEvent.execute({ eventId: event.eventId, kind: "task", targetId: secret.id }))
    expect(failureTag(exit)).toBe("NotFound")
  })

  test("thread replies cannot be linked, only thread roots", async () => {
    const channel = await runAs(
      database,
      owner.actor,
    )(chat.createChannel.execute({ name: "replies-room", kind: "public" }))
    const body = {
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    }
    const root = await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body }))
    const reply = await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body, threadRootId: root.id }))
    const event = await runAs(database, owner.actor)(createEvent.execute(eventInput(openCalendar)))
    const exit = await exitAs(
      database,
      owner.actor,
    )(linkEvent.execute({ eventId: event.eventId, kind: "thread", targetId: reply.id }))
    expect(failureTag(exit)).toBe("ValidationError")
  })
})
