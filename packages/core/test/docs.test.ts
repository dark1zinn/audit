import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createDoc } from "@audit/core/docs/commands"
import { createDocComment } from "@audit/core/docs/comments"
import { getDoc, spaceTree } from "@audit/core/docs/queries"
import { backlinks, resolveEntities, syncReferences } from "@audit/core/references"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { DocId, EntityId, ProjectId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Exit, Option } from "effect"
import { createChannel, postMessage } from "@audit/core/chat/commands"
import { createProject } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import { createTask } from "@audit/core/tasks/commands"
import { createCalendar, createEvent } from "@audit/core/calendar/commands"

const messageBody = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

let database: TestDatabase
let owner: Person
let member: Person
let guest: Person

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

const spaceId = WORKSPACE_SPACE_ID as EntityId

const createSpaceDoc = (actor: Person, title: string) =>
  runAs(
    database,
    actor.actor,
  )(createDoc.execute({ parentId: spaceId, title })).then((doc) => doc.id as DocId)

const restrict = (docId: DocId) =>
  database.superuser`update entities set restricted = true where id = ${docId}`

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Mia", "member")
  guest = await addPerson(database, owner, "Gus", "guest")
})

afterAll(() => database.drop())

describe("space docs", () => {
  test("members with editor on the space can create docs, guests cannot", async () => {
    const exit = await exitAs(
      database,
      guest.actor,
    )(createDoc.execute({ parentId: spaceId, title: "Nope" }))
    expect(failureTag(exit)).not.toBe("success")
    const docId = await createSpaceDoc(member, "Member doc")
    const tree = await runAs(database, member.actor)(spaceTree())
    expect(tree.some((node) => node.id === docId)).toBe(true)
  })

  test("restricted docs are hidden from members without a grant", async () => {
    const docId = await createSpaceDoc(owner, "Secret")
    await restrict(docId)
    const memberTree = await runAs(database, member.actor)(spaceTree())
    expect(memberTree.some((node) => node.id === docId)).toBe(false)
    const ownerTree = await runAs(database, owner.actor)(spaceTree())
    // owners/admins manage all project content
    expect(ownerTree.some((node) => node.id === docId)).toBe(true)
  })

  test("reading a restricted doc fails for members", async () => {
    const docId = await createSpaceDoc(owner, "Hidden")
    await restrict(docId)
    const exit = await exitAs(database, member.actor)(getDoc(docId))
    expect(failureTag(exit)).not.toBe("success")
  })

  test("a deleted doc shows as deleted only to callers who could see it", async () => {
    const hiddenId = await createSpaceDoc(owner, "Masked")
    await restrict(hiddenId)
    const goneId = await createSpaceDoc(owner, "Gone")
    const goneHiddenId = await createSpaceDoc(owner, "Gone and hidden")
    await restrict(goneHiddenId)
    await database.superuser`insert into access_entries (resource_id, principal_type, principal_id, role, granted_by) values (${goneHiddenId}, 'user', ${owner.userId}, 'manager', ${owner.userId})`
    await database.superuser`update entities set deleted_at = now() where id in (${goneId}, ${goneHiddenId})`

    const refs = await runAs(
      database,
      member.actor,
    )(resolveEntities([hiddenId, goneId, goneHiddenId] as EntityId[]))
    expect(refs[hiddenId]).toEqual({ id: hiddenId, restricted: true, deleted: false })
    // The member could read "Gone": it is reported deleted, with its type but not its title.
    expect(refs[goneId]).toEqual({ id: goneId, type: "doc", restricted: false, deleted: true })
    // The member never could read "Gone and hidden": deletion is not revealed.
    expect(refs[goneHiddenId]).toEqual({ id: goneHiddenId, restricted: true, deleted: false })

    const ownerRefs = await runAs(
      database,
      owner.actor,
    )(resolveEntities([goneHiddenId as EntityId]))
    expect(ownerRefs[goneHiddenId]).toEqual({
      id: goneHiddenId,
      type: "doc",
      restricted: false,
      deleted: true,
    })
  })

  test("a person's reference sync keeps targets they cannot see", async () => {
    const sourceId = await createSpaceDoc(owner, "Linker")
    const visibleId = await createSpaceDoc(owner, "Open target")
    const hiddenId = await createSpaceDoc(owner, "Secret target")
    await restrict(hiddenId)
    await runAs(
      database,
      owner.actor,
    )(syncReferences(sourceId as EntityId, "link", [{ targetId: visibleId as EntityId }]))
    // The owner has no grant on the restricted target, so the link is written directly.
    await database.superuser`
      insert into "references" (source_id, target_id, kind)
      values (${sourceId}, ${hiddenId}, 'link')`

    await runAs(database, member.actor)(syncReferences(sourceId as EntityId, "link", []))

    const rows = await database.superuser`
      select target_id from "references" where source_id = ${sourceId} and kind = 'link'`
    expect(rows.map((row: { target_id: string }) => row.target_id)).toEqual([hiddenId])
  })

  test("backlinks into a target the person cannot see are empty", async () => {
    const sourceId = await createSpaceDoc(owner, "Citing")
    const hiddenId = await createSpaceDoc(owner, "Hidden cited")
    await restrict(hiddenId)
    await runAs(
      database,
      owner.actor,
    )(syncReferences(sourceId as EntityId, "link", [{ targetId: hiddenId as EntityId }]))

    expect(await runAs(database, member.actor)(backlinks(hiddenId as EntityId))).toEqual([])
  })
})

describe("doc comments", () => {
  test("guests cannot comment on a space doc, members can", async () => {
    const docId = await createSpaceDoc(owner, "Discuss")
    const body = { type: "doc", content: [] }
    const guestExit = await exitAs(database, guest.actor)(createDocComment.execute({ docId, body }))
    expect(failureTag(guestExit)).not.toBe("success")
    const comment = await runAs(database, member.actor)(createDocComment.execute({ docId, body }))
    expect(comment.docId).toBe(docId)
  })
})

describe("entity route data", () => {
  test("visible tasks, project docs and messages carry the route fields for chips", async () => {
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "ROUTE", name: "Routes", visibility: "workspace" }))
    const projectId = project.id as ProjectId
    const boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId)))!
    const task = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Linked task" }))
    const projectDoc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: projectId, title: "Project note" }))
    const channel = await runAs(
      database,
      owner.actor,
    )(createChannel.execute({ name: "route-room", kind: "public" }))
    const message = await runAs(
      database,
      owner.actor,
    )(postMessage.execute({ channelId: channel.id, body: messageBody("hello") }))

    const refs = await runAs(
      database,
      owner.actor,
    )(resolveEntities([task.id, projectDoc.id, message.id] as EntityId[]))
    expect(refs[task.id]).toMatchObject({
      projectKey: "ROUTE",
      number: 1,
      key: "ROUTE-1",
    })
    expect(refs[projectDoc.id]?.projectKey).toBe("ROUTE")
    expect(refs[projectDoc.id]?.number).toBeUndefined()
    expect(refs[message.id]?.channelId).toBe(channel.id)
  })

  test("a restricted task returns no route data", async () => {
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "SECRET", name: "Secret", visibility: "workspace" }))
    const boardId = (await runAs(database, owner.actor)(defaultBoardId(project.id as ProjectId)))!
    const task = await runAs(
      database,
      owner.actor,
    )(createTask.execute({ boardId, title: "Hidden task" }))
    await database.superuser`update entities set restricted = true where id = ${task.id}`

    const refs = await runAs(database, member.actor)(resolveEntities([task.id] as EntityId[]))
    expect(refs[task.id]).toEqual({ id: task.id, restricted: true, deleted: false })
  })

  test("visible events carry startsAt; a restricted event carries none", async () => {
    const calendar = await runAs(
      database,
      owner.actor,
    )(createCalendar.execute({ name: "Deadlines", color: "#336699", teamId: null }))
    const event = await runAs(
      database,
      owner.actor,
    )(
      createEvent.execute({
        calendarId: calendar.id,
        title: "Launch",
        startsAt: new Date("2026-06-10T15:00:00Z"),
        endsAt: new Date("2026-06-10T16:00:00Z"),
        allDay: false,
        timezone: "UTC",
        rrule: null,
        location: "",
        description: null,
        attendees: [],
        reminders: [],
      }),
    )
    const eventId = event.eventId as EntityId
    const visible = await runAs(database, owner.actor)(resolveEntities([eventId]))
    expect(visible[eventId]?.startsAt).toBe("2026-06-10T15:00:00.000Z")

    await database.superuser`update entities set restricted = true where id = ${eventId}`
    const hidden = await runAs(database, member.actor)(resolveEntities([eventId]))
    expect(hidden[eventId]).toEqual({ id: eventId, restricted: true, deleted: false })
  })
})
