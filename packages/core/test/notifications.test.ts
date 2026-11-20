import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createChannel } from "@audit/core/chat/commands"
import { createDoc } from "@audit/core/docs/commands"
import * as identity from "@audit/core/identity/commands"
import {
  archiveNotification,
  markAllNotificationsRead,
  subscribePush,
  updateNotificationPref,
  updateQuietHours,
} from "@audit/core/notifications/commands"
import { inviteMailJob, sendInviteEmail } from "@audit/core/notifications/account-mail"
import { deliverNotification } from "@audit/core/notifications/deliver"
import { deliverJob, notify } from "@audit/core/notifications/notify"
import { myNotifications } from "@audit/core/notifications/queries"
import { defaultBoardId } from "@audit/core/projects/read"
import {
  createProject,
  grantProjectAccess,
  revokeProjectAccess,
} from "@audit/core/projects/commands"
import { createTask } from "@audit/core/tasks/commands"
import { EntityId, UserId } from "@audit/domain/ids"
import type { BoardId, ProjectId } from "@audit/domain/ids"
import { NotificationKind } from "@audit/domain/notifications/schema"
import { Effect, Schema } from "effect"
import * as Command from "@audit/core/command"
import { translate } from "@audit/i18n/server"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace, system } from "@audit/testkit/fixtures"

let database: TestDatabase
let owner: Person
let assignee: Person
let outsider: Person
let projectId: ProjectId
let boardId: BoardId

const inboxOf = (person: Person) => runAs(database, person.actor)(myNotifications(false))

/** A subscription as a browser would hand it over: a real P-256 key and a 16-byte auth secret. */
const subscribeAs = async (person: Person, endpoint: string) => {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  await runAs(
    database,
    person.actor,
  )(
    subscribePush.execute({
      endpoint,
      p256dh: Buffer.from(raw).toString("base64url"),
      auth: Buffer.from(auth).toString("base64url"),
    }),
  )
}

/** Triggers come from commands in the app, so the probe runs `notify` inside one as well. */
const NotifyProbe = Command.make("test.notify", {
  input: Schema.Struct({
    userId: UserId,
    kind: NotificationKind,
    entityId: EntityId,
    groupKey: Schema.String,
  }),
  output: Schema.Boolean,
  authorize: () => Effect.void,
  run: (input) =>
    notify({
      userId: input.userId,
      kind: input.kind,
      entityId: input.entityId,
      projectId: null,
      actorId: owner.userId,
      payload: { title: "Something happened" },
      groupKey: input.groupKey,
    }),
})

const notifyTo = (person: Person, kind: NotificationKind, entityId: string, groupKey: string) =>
  runAs(
    database,
    system,
  )(
    NotifyProbe.execute({
      userId: person.userId,
      kind,
      entityId: entityId as EntityId,
      groupKey,
    }),
  )

const deliverJobsFor = (notificationId: string) =>
  database.jobs.enqueued.filter(
    (job) =>
      job.name === deliverJob.name &&
      typeof job.data === "object" &&
      job.data !== null &&
      "notificationId" in job.data &&
      job.data.notificationId === notificationId,
  )

const pushCount = async (userId: UserId) => {
  const rows = await database.superuser`
    select count(*)::int as n from push_subscriptions where user_id = ${userId}`
  return Number(rows[0]?.n)
}

const hhmm = (date: Date) =>
  `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  assignee = await addPerson(database, owner, "Ana", "member")
  outsider = await addPerson(database, owner, "Bia", "member")

  const project = await runAs(
    database,
    owner.actor,
  )(createProject.execute({ key: "NOTIFY", name: "Notify", visibility: "restricted" }))
  projectId = project.id as ProjectId
  boardId = (await runAs(database, owner.actor)(defaultBoardId(projectId)))!
  await runAs(
    database,
    owner.actor,
  )(
    grantProjectAccess.execute({
      projectId,
      principalType: "user",
      principalId: assignee.userId,
      role: "editor",
    }),
  )
})

afterAll(() => database.drop())

describe("no leaks after access is lost", () => {
  test("a task notice is neither stored nor pushed once the recipient loses the project", async () => {
    const task = await runAs(
      database,
      owner.actor,
    )(
      createTask.execute({
        boardId,
        title: "Secret plan",
        assignees: [assignee.userId as UserId],
      }),
    )
    const taskId = task.id as string
    await subscribeAs(assignee, "https://push.example.test/ana")
    const before = await inboxOf(assignee)
    const assigned = before.find((item) => item.entityId === taskId)
    expect(assigned).toBeDefined()

    await runAs(
      database,
      owner.actor,
    )(
      revokeProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: assignee.userId,
      }),
    )

    const stored = await notifyTo(assignee, "task_changed", taskId, `changed:${taskId}`)
    expect(stored).toBe(false)
    const after = await inboxOf(assignee)
    expect(after.filter((item) => item.entityId === taskId).length).toBe(0)

    const pushesBefore = database.push.requests.length
    await runAs(
      database,
      system,
    )(deliverNotification({ notificationId: assigned!.id, channel: "push" }))
    expect(database.push.requests.length).toBe(pushesBefore)
  })

  test("a restricted doc and a private channel never notify a stranger", async () => {
    const doc = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: projectId, title: "Restricted doc" }))
    const channel = await runAs(
      database,
      owner.actor,
    )(createChannel.execute({ name: "secret-room", kind: "private" }))

    expect(await notifyTo(outsider, "comment_added", doc.id as string, "doc")).toBe(false)
    expect(await notifyTo(outsider, "mention", channel.id as string, "channel")).toBe(false)
    expect(await inboxOf(outsider)).toHaveLength(0)
  })
})

describe("burst and quiet hours", () => {
  test("three rapid changes fold into one notice with a count", async () => {
    const person = await addPerson(database, owner, "Caio", "member")
    for (let i = 0; i < 3; i++) {
      await notifyTo(person, "task_changed", person.userId, "burst-group")
    }
    const items = (await inboxOf(person)).filter((item) => item.entityId === person.userId)
    expect(items).toHaveLength(1)
    expect(items[0]!.payload.count).toBe(3)
  })

  test("quiet hours defer push and email but keep the in-app notice", async () => {
    const quiet = await addPerson(database, owner, "Dani", "member")
    const awake = await addPerson(database, owner, "Eva", "member")
    await runAs(database, quiet.actor)(identity.updateProfile.execute({ timezone: "UTC" }))
    const now = new Date()
    await runAs(
      database,
      quiet.actor,
    )(
      updateQuietHours.execute({
        quietStart: hhmm(new Date(now.getTime() - 3_600_000)),
        quietEnd: hhmm(new Date(now.getTime() + 3_600_000)),
      }),
    )
    await notifyTo(quiet, "mention", quiet.userId, "quiet")
    await notifyTo(awake, "mention", awake.userId, "awake")

    const quietId = (await inboxOf(quiet)).find((item) => item.entityId === quiet.userId)!.id
    const awakeId = (await inboxOf(awake)).find((item) => item.entityId === awake.userId)!.id
    const quietJobs = deliverJobsFor(quietId)
    expect(quietJobs.length).toBe(2)
    for (const job of quietJobs) {
      expect(job.options?.startAfter).toBeInstanceOf(Date)
    }
    for (const job of deliverJobsFor(awakeId)) {
      expect(job.options?.startAfter).toBeUndefined()
    }
  })
})

describe("preferences and delivery", () => {
  test("a disabled channel for a kind is not scheduled, the others still are", async () => {
    const person = await addPerson(database, owner, "Fabi", "member")
    await runAs(
      database,
      person.actor,
    )(
      updateNotificationPref.execute({
        kind: "mention",
        channel: "email",
        enabled: false,
      }),
    )
    await notifyTo(person, "mention", person.userId, "prefs")
    const id = (await inboxOf(person)).find((item) => item.entityId === person.userId)!.id
    const channels = deliverJobsFor(id).map((job) => (job.data as { channel: string }).channel)
    expect(channels).toEqual(["push"])
  })

  test("a push service answer of 410 removes the subscription", async () => {
    const person = await addPerson(database, owner, "Gabi", "member")
    await subscribeAs(person, "https://push.example.test/gone")
    await notifyTo(person, "mention", person.userId, "gone")
    const id = (await inboxOf(person)).find((item) => item.entityId === person.userId)!.id
    expect(await pushCount(person.userId)).toBe(1)

    const sentBefore = database.push.requests.length
    database.push.status = 410
    await runAs(database, system)(deliverNotification({ notificationId: id, channel: "push" }))
    database.push.status = 201
    expect(database.push.requests.length).toBe(sentBefore + 1)
    expect(await pushCount(person.userId)).toBe(0)
  })

  test("pt-BR recipients get pt-BR email, falling back to the workspace default", async () => {
    const ptUser = await addPerson(database, owner, "Hugo", "member")
    await runAs(database, ptUser.actor)(identity.updateProfile.execute({ locale: "pt-BR" }))
    await notifyTo(ptUser, "mention", ptUser.userId, "pt")
    const ptId = (await inboxOf(ptUser)).find((item) => item.entityId === ptUser.userId)!.id
    await runAs(database, system)(deliverNotification({ notificationId: ptId, channel: "email" }))
    const ptMail = database.mail.at(-1)!
    expect(ptMail.to).toBe(ptUser.email)
    expect(ptMail.text.endsWith(translate("pt-BR", { id: "email.footer" }))).toBe(true)

    await database.superuser`
      update workspace set settings = jsonb_set(settings, '{defaultLocale}', '"pt-BR"')`
    const fallback = await addPerson(database, owner, "Iago", "member")
    await runAs(database, fallback.actor)(identity.updateProfile.execute({ locale: null }))
    await notifyTo(fallback, "mention", fallback.userId, "fallback")
    const fallbackId = (await inboxOf(fallback)).find(
      (item) => item.entityId === fallback.userId,
    )!.id
    await runAs(
      database,
      system,
    )(deliverNotification({ notificationId: fallbackId, channel: "email" }))
    const fallbackMail = database.mail.at(-1)!
    expect(fallbackMail.text.endsWith(translate("pt-BR", { id: "email.footer" }))).toBe(true)
  })
})

describe("inbox actions", () => {
  test("read-all clears unread state and archive hides a notice from the active list", async () => {
    const person = await addPerson(database, owner, "Julia", "member")
    await notifyTo(person, "mention", person.userId, "inbox-a")
    await notifyTo(person, "direct_message", person.userId, "inbox-b")
    const items = await inboxOf(person)
    expect(items.length).toBeGreaterThanOrEqual(2)

    await runAs(database, person.actor)(markAllNotificationsRead.execute({}))
    const unread = await database.superuser`
      select count(*)::int as n from notifications where user_id = ${person.userId} and read_at is null`
    expect(Number(unread[0]?.n)).toBe(0)

    const target = items[0]!.id
    await runAs(database, person.actor)(archiveNotification.execute({ notificationId: target }))
    expect((await inboxOf(person)).some((item) => item.id === target)).toBe(false)
    expect(
      (await runAs(database, person.actor)(myNotifications(true))).some(
        (item) => item.id === target,
      ),
    ).toBe(true)
  })
})

describe("invites", () => {
  test("invite accepted reaches only admins who opted in, and the new user's entity is visible to them", async () => {
    const optedIn = await addPerson(database, owner, "Kika", "admin")
    const notOptedIn = await addPerson(database, owner, "Lu", "admin")
    await runAs(
      database,
      optedIn.actor,
    )(
      updateNotificationPref.execute({
        kind: "invite_accepted",
        channel: "in_app",
        enabled: true,
      }),
    )

    const newcomer = await addPerson(database, owner, "Mari", "member")
    const notice = (await inboxOf(optedIn)).find(
      (item) => item.kind === "invite_accepted" && item.entityId === newcomer.userId,
    )
    expect(notice).toBeDefined()
    expect((await inboxOf(notOptedIn)).some((item) => item.kind === "invite_accepted")).toBe(false)
    expect((await inboxOf(owner)).some((item) => item.kind === "invite_accepted")).toBe(false)
  })

  test("an invite with an address emails it in the workspace default locale", async () => {
    await database.superuser`
      update workspace set settings = jsonb_set(settings, '{defaultLocale}', '"pt-BR"')`
    const before = database.mail.length
    await runAs(
      database,
      owner.actor,
    )(identity.createInvite.execute({ role: "member", email: "convidada@example.test" }))
    // The command only queues the mail; the worker sends it.
    expect(database.mail.length).toBe(before)
    const queued = database.jobs.enqueued.filter((job) => job.name === inviteMailJob.name).at(-1)
    const data = Schema.decodeUnknownSync(inviteMailJob.schema)(queued?.data)
    expect(data.email).toBe("convidada@example.test")
    await runAs(database, system)(sendInviteEmail(data))
    expect(database.mail.length).toBe(before + 1)
    const sent = database.mail.at(-1)!
    expect(sent.to).toBe("convidada@example.test")
    expect(sent.text).toContain("/join/")
    expect(sent.subject).toBe(
      translate("pt-BR", { id: "email.invite_subject" }, { workspace: "Test workspace" }),
    )
  })
})

describe("push endpoints", () => {
  const refusedAt = (person: Person, endpoint: string) =>
    runAs(
      database,
      person.actor,
    )(subscribePush.execute({ endpoint, p256dh: "AAAA", auth: "AAAA" }).pipe(Effect.flip))

  test("a non-https endpoint, or one with credentials, is refused at subscribe", async () => {
    const person = await addPerson(database, owner, "Nina", "member")
    for (const endpoint of [
      "http://push.example.test/plain",
      "https://user:secret@push.example.test/creds",
      "https://:443/no-host",
    ]) {
      expect((await refusedAt(person, endpoint))._tag).toBe("ValidationError")
    }
    expect(await pushCount(person.userId)).toBe(0)
  })

  test("internal, loopback and link-local addresses and localhost are refused at subscribe", async () => {
    const person = await addPerson(database, owner, "Otto", "member")
    for (const endpoint of [
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/push",
      "https://10.0.0.1/push",
      "https://192.168.1.10/push",
      "https://100.64.0.1/push",
      "https://0.0.0.0/push",
      "https://localhost/push",
      "https://[::1]/push",
      "https://[::ffff:127.0.0.1]/push",
      "https://[fe80::1]/push",
      "https://[fd00::1]/push",
    ]) {
      expect((await refusedAt(person, endpoint))._tag).toBe("ValidationError")
    }
    expect(await pushCount(person.userId)).toBe(0)
  })

  test("a public https endpoint is accepted", async () => {
    const person = await addPerson(database, owner, "Pedro", "member")
    await subscribeAs(person, "https://push.example.test/public")
    expect(await pushCount(person.userId)).toBe(1)
  })

  test("another user cannot take over an endpoint that is already subscribed", async () => {
    const first = await addPerson(database, owner, "Quinn", "member")
    const second = await addPerson(database, owner, "Rosa", "member")
    await subscribeAs(first, "https://push.example.test/shared")

    const error = await refusedAt(second, "https://push.example.test/shared")
    expect(error._tag).toBe("Conflict")
    expect(await pushCount(second.userId)).toBe(0)
    const rows = await database.superuser`
      select user_id from push_subscriptions where endpoint = 'https://push.example.test/shared'`
    expect(rows[0]?.user_id).toBe(first.userId)
  })

  test("delivery is refused when the host now resolves to a private address", async () => {
    const person = await addPerson(database, owner, "Sami", "member")
    const endpoint = "https://rebind.example.test/sami"
    await subscribeAs(person, endpoint)
    database.push.addresses.set("rebind.example.test", ["10.0.0.5"])
    try {
      await notifyTo(person, "mention", person.userId, "rebind")
      const id = (await inboxOf(person)).find((item) => item.entityId === person.userId)!.id
      await runAs(database, system)(deliverNotification({ notificationId: id, channel: "push" }))
    } finally {
      database.push.addresses.delete("rebind.example.test")
    }
    expect(database.push.requests.some((request) => request.url === endpoint)).toBe(false)
    expect(await pushCount(person.userId)).toBe(1)
  })
})

describe("inbox visibility", () => {
  test("a notice about a project disappears from the inbox once the person loses access", async () => {
    const person = await addPerson(database, owner, "Tomas", "member")
    await runAs(
      database,
      owner.actor,
    )(
      grantProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: person.userId,
        role: "editor",
      }),
    )
    await notifyTo(person, "mention", projectId, "inbox-visibility")
    expect((await inboxOf(person)).some((item) => item.entityId === projectId)).toBe(true)

    await runAs(
      database,
      owner.actor,
    )(
      revokeProjectAccess.execute({
        projectId,
        principalType: "user",
        principalId: person.userId,
      }),
    )
    expect((await inboxOf(person)).some((item) => item.entityId === projectId)).toBe(false)
  })
})
