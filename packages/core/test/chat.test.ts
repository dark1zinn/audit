import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as chat from "@audit/core/chat/commands"
import * as chatQueries from "@audit/core/chat/queries"
import * as identity from "@audit/core/identity/commands"
import { createProject } from "@audit/core/projects/commands"
import { defaultBoardId } from "@audit/core/projects/read"
import type { ChannelId, MessageId, ProjectId, UserId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, exitAs, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Exit } from "effect"

let database: TestDatabase
let owner: Person
let mia: Person
let sam: Person
let pool: Person[]

const paragraph = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

const mentionOf = (id: string, type: string) => ({
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "hey " },
        { type: "mention", attrs: { id, type } },
      ],
    },
  ],
})

const notificationCount = async (userId: string, kind: string) => {
  const rows =
    await database.superuser`select count(*)::int as n from notifications where user_id = ${userId} and kind = ${kind}`
  return rows[0]?.n ?? 0
}

const trailCount = async (action: string) => {
  const rows =
    await database.superuser`select count(*)::int as n from trail_events where action = ${action}`
  return rows[0]?.n ?? 0
}

const summaryFor = async (person: Person, channelId: ChannelId) => {
  const list = await runAs(database, person.actor)(chatQueries.sidebar(person.userId))
  const found = list.find((channel) => channel.id === channelId)
  if (found === undefined) throw new Error("channel missing from sidebar")
  return found
}

const newChannel = (name: string, kind: "public" | "private") =>
  runAs(database, owner.actor)(chat.createChannel.execute({ name, kind }))

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  mia = await addPerson(database, owner, "Mia", "member")
  sam = await addPerson(database, owner, "Sam", "member")
  pool = [mia, sam]
  for (const name of ["Ana", "Ben", "Cy", "Dee", "Eli", "Fay"]) {
    pool.push(await addPerson(database, owner, name, "member"))
  }
}, 60_000)

afterAll(() => database.drop())

describe("channels and unread state", () => {
  test("mentions notify the mentioned member and mark-read clears unread", async () => {
    const channel = await newChannel("general", "public")
    await runAs(database, mia.actor)(chat.joinChannel.execute({ channelId: channel.id }))
    const posted = await runAs(
      database,
      owner.actor,
    )(
      chat.postMessage.execute({
        channelId: channel.id,
        body: mentionOf(mia.userId, "user"),
      }),
    )

    const before = await summaryFor(mia, channel.id)
    expect(before.unread).toBe(1)
    expect(before.mentions).toBe(1)
    // The author's own message is never unread for them.
    expect((await summaryFor(owner, channel.id)).unread).toBe(0)

    await runAs(
      database,
      mia.actor,
    )(chat.markRead.execute({ channelId: channel.id, messageId: posted.id }))
    const after = await summaryFor(mia, channel.id)
    expect(after.unread).toBe(0)
    expect(after.mentions).toBe(0)
    expect(after.lastReadMessageId).toBe(posted.id)
  })

  test("a DM pair opens to one channel", async () => {
    const first = await runAs(database, owner.actor)(chat.openDm.execute({ userIds: [mia.userId] }))
    const second = await runAs(
      database,
      owner.actor,
    )(chat.openDm.execute({ userIds: [mia.userId] }))
    expect(first.kind).toBe("dm")
    expect(second.id).toBe(first.id)
  })

  test("group DM allows 8 people including self and rejects more", async () => {
    const eight = pool.slice(0, 7).map((person) => person.userId)
    const group = await runAs(database, owner.actor)(chat.openDm.execute({ userIds: eight }))
    expect(group.kind).toBe("group_dm")

    const nine = pool.map((person) => person.userId)
    const tooMany = await exitAs(database, owner.actor)(chat.openDm.execute({ userIds: nine }))
    expect(Exit.isFailure(tooMany)).toBe(true)
  })

  test("a non-member cannot post in a private channel", async () => {
    const channel = await newChannel("secret", "private")
    const exit = await exitAs(
      database,
      sam.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("hi") }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("@channel works in a channel with 20 or fewer members and notifies the members", async () => {
    const channel = await newChannel("small", "public")
    await runAs(database, mia.actor)(chat.joinChannel.execute({ channelId: channel.id }))
    const beforeMia = await notificationCount(mia.userId, "mention")
    const exit = await exitAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: mentionOf("channel", "channel") }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect((await notificationCount(mia.userId, "mention")) - beforeMia).toBe(1)
  })

  test("@channel in a channel over 20 members is limited to managers", async () => {
    const channel = await newChannel("crowded", "public")
    const crowd: Person[] = []
    for (let i = 0; i < 20; i++) {
      crowd.push(await addPerson(database, owner, `Crowd ${i}`, "member"))
    }
    await runAs(
      database,
      owner.actor,
    )(chat.addMembers.execute({ channelId: channel.id, userIds: crowd.map((p) => p.userId) }))
    const denied = await exitAs(
      database,
      mia.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: mentionOf("here", "here") }))
    expect(Exit.isFailure(denied)).toBe(true)

    const allowed = await exitAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: mentionOf("here", "here") }))
    expect(Exit.isSuccess(allowed)).toBe(true)
  }, 30_000)

  test("a mention notifies only the mentioned person when they can see the channel", async () => {
    const channel = await newChannel("hidden-mention", "private")
    await runAs(
      database,
      owner.actor,
    )(chat.addMembers.execute({ channelId: channel.id, userIds: [mia.userId] }))
    const beforeSam = await notificationCount(sam.userId, "mention")
    await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: mentionOf(sam.userId, "user") }))
    expect((await notificationCount(sam.userId, "mention")) - beforeSam).toBe(0)
  })

  test("a team mention notifies its members who can see the channel", async () => {
    const channel = await newChannel("team-mention", "public")
    const teamId = await runAs(
      database,
      owner.actor,
    )(identity.createTeam.execute({ name: "Reviewers", slug: "reviewers-chat" }))
    await runAs(
      database,
      owner.actor,
    )(identity.setTeamMember.execute({ teamId, userId: sam.userId, role: "member" }))
    const before = await notificationCount(sam.userId, "mention")
    await runAs(
      database,
      owner.actor,
    )(
      chat.postMessage.execute({
        channelId: channel.id,
        body: mentionOf(teamId, "team"),
      }),
    )
    expect((await notificationCount(sam.userId, "mention")) - before).toBe(1)
  })

  test("a stale mark-read never moves the read marker backwards", async () => {
    const channel = await newChannel("marks", "public")
    await runAs(database, mia.actor)(chat.joinChannel.execute({ channelId: channel.id }))
    const first = await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("one") }))
    const second = await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("two") }))
    await runAs(
      database,
      mia.actor,
    )(chat.markRead.execute({ channelId: channel.id, messageId: second.id }))
    await runAs(
      database,
      mia.actor,
    )(chat.markRead.execute({ channelId: channel.id, messageId: first.id }))
    expect((await summaryFor(mia, channel.id)).lastReadMessageId).toBe(second.id)
  })

  test("a guest reads and posts in a public channel only after being added", async () => {
    const guest = await addPerson(database, owner, "Gia Guest", "guest")
    const channel = await newChannel("guest-room", "public")
    const before = await exitAs(
      database,
      guest.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("hi") }))
    expect(Exit.isFailure(before)).toBe(true)

    await runAs(
      database,
      owner.actor,
    )(chat.addMembers.execute({ channelId: channel.id, userIds: [guest.userId] }))
    const after = await exitAs(
      database,
      guest.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("hi") }))
    expect(Exit.isSuccess(after)).toBe(true)
  })
})

describe("threads", () => {
  test("a reply bumps the root's reply count and auto-follows the thread for its author", async () => {
    const channel = await newChannel("threads", "public")
    await runAs(database, mia.actor)(chat.joinChannel.execute({ channelId: channel.id }))
    const root = await runAs(
      database,
      mia.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("root") }))
    await runAs(
      database,
      owner.actor,
    )(
      chat.postMessage.execute({
        channelId: channel.id,
        body: paragraph("reply"),
        threadRootId: root.id,
      }),
    )

    const view = await runAs(
      database,
      mia.actor,
    )(chatQueries.threadView(root.id as MessageId, {}, mia.userId as UserId))
    expect(view.root.replyCount).toBe(1)
    expect(view.following).toBe(true)
  })

  test("a thread in a private channel is hidden from people outside it", async () => {
    const channel = await runAs(
      database,
      owner.actor,
    )(chat.createChannel.execute({ name: "threads-private", kind: "private" }))
    const root = await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("secret root") }))
    await runAs(
      database,
      owner.actor,
    )(
      chat.postMessage.execute({
        channelId: channel.id,
        body: paragraph("secret reply"),
        threadRootId: root.id,
      }),
    )

    const exit = await exitAs(
      database,
      sam.actor,
    )(chatQueries.threadView(root.id as MessageId, {}, sam.userId as UserId))
    expect(exit._tag).toBe("Failure")
    const followExit = await exitAs(
      database,
      sam.actor,
    )(chat.followThread.execute({ messageId: root.id as MessageId }))
    expect(followExit._tag).toBe("Failure")
  })
})

describe("admin reads of private channels", () => {
  test("an owner reading a private channel they are not in is flagged and trailed each time", async () => {
    const channel = await runAs(
      database,
      mia.actor,
    )(chat.createChannel.execute({ name: "mias-private", kind: "private" }))
    await runAs(
      database,
      mia.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("private") }))

    const before = await trailCount("admin.read_private")
    const page = await runAs(
      database,
      owner.actor,
    )(chatQueries.adminMessages(channel.id, {}, owner.userId as UserId))
    expect(page.adminRead).toBe(true)
    expect(page.messages.length).toBe(1)
    expect(await trailCount("admin.read_private")).toBe(before + 1)
  })
})

describe("turning talk into work", () => {
  test("a message becomes a task with a link back from the message", async () => {
    const project = await runAs(
      database,
      owner.actor,
    )(createProject.execute({ key: "CHT", name: "Chat work" }))
    const boardId = await runAs(database, owner.actor)(defaultBoardId(project.id as ProjectId))
    const channel = await newChannel("work-talk", "public")
    const message = await runAs(
      database,
      owner.actor,
    )(chat.postMessage.execute({ channelId: channel.id, body: paragraph("Fix the login timeout") }))
    const created = await runAs(
      database,
      owner.actor,
    )(chat.messageToTask.execute({ messageId: message.id, boardId: boardId! }))
    const links = await database.superuser`select count(*)::int as n from "references"
      where source_id = ${message.id} and target_id = ${created.taskId} and kind = 'link'`
    expect(links[0]?.n).toBe(1)
    const [task] = await database.superuser`select title from entities where id = ${created.taskId}`
    expect(task?.title).toBe("Fix the login timeout")
  })
})
