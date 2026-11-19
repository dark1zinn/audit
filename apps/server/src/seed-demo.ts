/**
 * `audit seed --demo`: fills an empty workspace with demo data through the real commands, so the
 * same authorization, trail, and search indexing paths run as in production. Deterministic: the
 * content comes from a seeded PRNG, so every run produces the same people, titles, and messages.
 */
import * as calendar from "@audit/core/calendar/commands"
import * as chat from "@audit/core/chat/commands"
import * as chatQueries from "@audit/core/chat/queries"
import * as docs from "@audit/core/docs/commands"
import * as identity from "@audit/core/identity/commands"
import * as projects from "@audit/core/projects/commands"
import * as tasks from "@audit/core/tasks/commands"
import { type Actor, CurrentActor } from "@audit/domain/actor"
import type {
  BoardId,
  CalendarId,
  ChannelId,
  MessageId,
  ProjectId,
  UserId,
} from "@audit/domain/ids"
import { Data, Effect } from "effect"
import { SqlClient } from "effect/sql"

/** The workspace state forbids seeding: content exists, or members exist without `--force`. */
export class SeedRefused extends Data.TaggedError("SeedRefused")<{ readonly message: string }> {}

/** The seed could not read or create data it depends on. */
export class SeedFailed extends Data.TaggedError("SeedFailed")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const DAY = 24 * 60 * 60 * 1000
const SEED = 20240601
const DEMO_PASSWORD = "correct horse battery staple"
const OWNER_EMAIL = "owner@example.test"
const SYSTEM: Actor = { _tag: "system", reason: "cli" }
const TASKS_PER_PROJECT = 400
const DOCS = 200
const EVENTS = 200
const MESSAGES_PER_CHANNEL = 1000
const THREAD_ROOM = 200

const PEOPLE = [
  "Ana Souza",
  "Bruno Lima",
  "Carla Mendes",
  "Diego Alves",
  "Elisa Rocha",
  "Felipe Costa",
  "Gabriela Nunes",
  "Heitor Dias",
  "Isabela Ramos",
  "Joao Pereira",
  "Karen Duarte",
  "Lucas Teixeira",
  "Marina Cardoso",
  "Nicolas Faria",
  "Olivia Pinto",
  "Paulo Ribeiro",
  "Quirino Moura",
  "Renata Lopes",
  "Samuel Gomes",
  "Tatiana Vieira",
  "Ugo Barros",
  "Vanessa Campos",
  "Wagner Correia",
  "Xenia Monteiro",
  "Yuri Fonseca",
]

const PROJECTS = [
  { key: "ENG", name: "Engineering" },
  { key: "OPS", name: "Operations" },
  { key: "MKT", name: "Marketing" },
  { key: "FIN", name: "Finance" },
  { key: "PRD", name: "Product" },
]

const CHANNELS: ReadonlyArray<{ readonly name: string; readonly kind: "public" | "private" }> = [
  ...["general", "random", "engineering", "ops", "marketing", "finance", "product", "design"].map(
    (name) => ({ name, kind: "public" as const }),
  ),
  ...["releases", "incidents", "hiring", "sales", "support", "legal", "data", "security"].map(
    (name) => ({ name, kind: "public" as const }),
  ),
  ...["leadership", "budget", "roadmap"].map((name) => ({ name, kind: "private" as const })),
]

const VERBS = ["Review", "Draft", "Fix", "Refactor", "Document", "Test", "Ship", "Plan", "Audit"]
const OBJECTS = [
  "the billing export",
  "the onboarding flow",
  "search ranking",
  "the invoice template",
  "retry policy",
  "the audit trail",
  "mobile navigation",
  "the release checklist",
  "calendar sync",
  "the vendor review",
  "data retention",
  "the metrics dashboard",
]
const AREAS = ["for Q3", "before launch", "in staging", "with support", "for EU customers"]
const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const
const DOC_KINDS = ["Runbook", "Notes", "Spec", "Playbook", "Report"]
const EVENT_TITLES = [
  "Sprint review",
  "Design sync",
  "Budget check-in",
  "Customer call",
  "Release planning",
  "Retro",
  "Hiring panel",
  "Roadmap review",
  "Incident postmortem",
  "One on one",
]
const WORDS = [
  "release",
  "customer",
  "invoice",
  "deploy",
  "search",
  "review",
  "metric",
  "pipeline",
  "budget",
  "roadmap",
  "incident",
  "contract",
  "onboarding",
  "dashboard",
  "sprint",
  "design",
  "database",
  "migration",
  "latency",
  "report",
  "forecast",
  "vendor",
  "policy",
  "backlog",
  "queue",
  "cache",
  "rollout",
  "feature",
  "owner",
  "handoff",
  "meeting",
  "decision",
  "risk",
  "staging",
]

/** mulberry32: small, fast, deterministic PRNG. */
export interface Random {
  readonly next: () => number
  readonly int: (max: number) => number
  readonly pick: <T>(items: ReadonlyArray<T>) => T
}

export const makeRandom = (seed: number): Random => {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (max: number) => Math.floor(next() * max)
  const pick = <T>(items: ReadonlyArray<T>): T => items[int(items.length)] as T
  return { next, int, pick }
}

const sentence = (rnd: Random): string => {
  const length = 6 + rnd.int(10)
  const text = Array.from({ length }, () => rnd.pick(WORDS)).join(" ")
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

interface Person {
  readonly userId: UserId
  readonly actor: Actor
}

interface Counts {
  readonly members: number
  readonly projects: number
  readonly tasks: number
  readonly docs: number
  readonly messages: number
  readonly events: number
}

interface Owner {
  readonly userId: UserId
  readonly actor: Actor
}

const log = (message: string) => Effect.sync(() => console.log(message))

const readCounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<Counts>`
    select
      (select count(*)::int from workspace_members) as members,
      (select count(*)::int from projects) as projects,
      (select count(*)::int from tasks) as tasks,
      (select count(*)::int from docs) as docs,
      (select count(*)::int from messages) as messages,
      (select count(*)::int from events) as events`
  const counts = rows[0]
  if (counts === undefined) {
    return yield* Effect.fail(new SeedFailed({ message: "could not read workspace state" }))
  }
  return counts
})

/** Creates the owner on an empty database, or reuses the existing owner when `--force` is set. */
const ensureOwner = (members: number) =>
  Effect.gen(function* () {
    if (members === 0) {
      const userId = yield* identity.completeSetup
        .execute({
          token: "cli-seed",
          workspaceName: "Demo workspace",
          name: "Demo owner",
          email: OWNER_EMAIL,
          password: DEMO_PASSWORD,
        })
        .pipe(Effect.provideService(CurrentActor, SYSTEM))
      yield* log(`workspace created; owner ${OWNER_EMAIL}`)
      return { userId, actor: { _tag: "user", userId, role: "owner" } } satisfies Owner
    }
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly id: UserId }>`
      select user_id as id from workspace_members where role = 'owner' limit 1`
    const owner = rows[0]
    if (owner === undefined) {
      return yield* Effect.fail(new SeedFailed({ message: "no workspace owner found" }))
    }
    return {
      userId: owner.id,
      actor: { _tag: "user", userId: owner.id, role: "owner" },
    } satisfies Owner
  })

const invitePeople = (owner: Owner) =>
  Effect.gen(function* () {
    const people: Person[] = []
    for (const name of PEOPLE) {
      const email = `${name.toLowerCase().replaceAll(" ", ".")}@example.test`
      const invite = yield* identity.createInvite
        .execute({ role: "member" })
        .pipe(Effect.provideService(CurrentActor, owner.actor))
      const token = invite.url.split("/join/")[1] ?? ""
      const userId = yield* identity.acceptInvite
        .execute({ token, name, email, password: DEMO_PASSWORD })
        .pipe(Effect.provideService(CurrentActor, SYSTEM))
      people.push({ userId, actor: { _tag: "user", userId, role: "member" } })
    }
    yield* log(`people: ${people.length} invited and accepted`)
    return people
  })

const seedProjects = (owner: Owner, rnd: Random, people: ReadonlyArray<Person>) =>
  Effect.gen(function* () {
    const everyone = [{ userId: owner.userId }, ...people].map((p) => p.userId)
    const projectRefs: Array<{ readonly id: ProjectId; readonly boardId: BoardId }> = []
    for (const project of PROJECTS) {
      const detail = yield* projects.createProject
        .execute({ key: project.key, name: project.name })
        .pipe(Effect.provideService(CurrentActor, owner.actor))
      if (detail.defaultBoardId === null) {
        return yield* Effect.fail(
          new SeedFailed({ message: `project ${project.key} has no default board` }),
        )
      }
      projectRefs.push({ id: detail.id, boardId: detail.defaultBoardId })
    }
    yield* log(`projects: ${projectRefs.length}`)

    const now = Date.now()
    for (const project of projectRefs) {
      for (let index = 0; index < TASKS_PER_PROJECT; index++) {
        const assignees = new Set([rnd.pick(everyone)])
        if (rnd.next() < 0.3) assignees.add(rnd.pick(everyone))
        yield* tasks.createTask
          .execute({
            boardId: project.boardId,
            title: `${rnd.pick(VERBS)} ${rnd.pick(OBJECTS)} ${rnd.pick(AREAS)}`,
            priority: rnd.pick(PRIORITIES),
            assignees: [...assignees],
            dueAt: new Date(now + (rnd.int(70) - 10) * DAY),
          })
          .pipe(Effect.provideService(CurrentActor, owner.actor))
      }
    }
    yield* log(`tasks: ${projectRefs.length * TASKS_PER_PROJECT}`)

    for (let index = 0; index < DOCS; index++) {
      const project = projectRefs[index % projectRefs.length]!
      const title = `${rnd.pick(DOC_KINDS)}: ${rnd.pick(OBJECTS)} ${index + 1}`
      const sections = Array.from({ length: 4 }, () =>
        Array.from({ length: 4 }, () => sentence(rnd)).join(" "),
      )
      yield* docs.importDoc
        .execute({
          parentId: project.id,
          title,
          markdown: `# ${title}\n\n${sections.join("\n\n")}\n`,
        })
        .pipe(Effect.provideService(CurrentActor, owner.actor))
    }
    yield* log(`docs: ${DOCS}`)
    return projectRefs
  })

const seedCalendar = (
  owner: Owner,
  rnd: Random,
  people: ReadonlyArray<Person>,
  projectRefs: ReadonlyArray<{ readonly id: ProjectId }>,
) =>
  Effect.gen(function* () {
    const calendarIds: CalendarId[] = []
    const personal = yield* calendar.createCalendar
      .execute({ name: "Team calendar", color: "#3366ff" })
      .pipe(Effect.provideService(CurrentActor, owner.actor))
    calendarIds.push(personal.id)
    for (const project of projectRefs) {
      const cal = yield* calendar.createCalendar
        .execute({ name: "Project calendar", color: "#22aa66", projectId: project.id })
        .pipe(Effect.provideService(CurrentActor, owner.actor))
      calendarIds.push(cal.id)
    }

    const now = Date.now()
    for (let index = 0; index < EVENTS; index++) {
      const startsAt = now + (rnd.int(60) - 10) * DAY + (9 + rnd.int(8)) * 60 * 60 * 1000
      const attendee = rnd.next() < 0.3 ? rnd.pick(people) : undefined
      yield* calendar.createEvent
        .execute({
          calendarId: rnd.pick(calendarIds),
          title: rnd.pick(EVENT_TITLES),
          startsAt: new Date(startsAt),
          endsAt: new Date(startsAt + 60 * 60 * 1000),
          allDay: false,
          timezone: "UTC",
          rrule: null,
          location: "",
          description: null,
          attendees:
            attendee === undefined ? [] : [{ principalType: "user", principalId: attendee.userId }],
          reminders: [10],
        })
        .pipe(Effect.provideService(CurrentActor, owner.actor))
    }
    yield* log(`events: ${EVENTS}`)
  })

const seedChannels = (owner: Owner, rnd: Random, people: ReadonlyArray<Person>) =>
  Effect.gen(function* () {
    // Workspace setup and project creation pre-create channels such as #general and #ops, so reuse
    // those by name; `channel.create` would fail on the unique channel name.
    const visible = [
      ...(yield* chatQueries.browse(owner.userId)),
      ...(yield* chatQueries.sidebar(owner.userId)),
    ]
    const byName = new Map(visible.map((c): [string, ChannelId] => [c.name, c.id]))
    for (const channel of CHANNELS) {
      const channelId: ChannelId =
        byName.get(channel.name) ??
        (yield* chat.createChannel
          .execute({ name: channel.name, kind: channel.kind })
          .pipe(Effect.provideService(CurrentActor, owner.actor))).id
      const members = channel.kind === "public" ? people : people.slice(0, 8)
      if (channel.kind === "public") {
        for (const person of people) {
          yield* chat.joinChannel
            .execute({ channelId })
            .pipe(Effect.provideService(CurrentActor, person.actor))
        }
      } else {
        yield* chat.addMembers
          .execute({ channelId, userIds: members.map((member) => member.userId) })
          .pipe(Effect.provideService(CurrentActor, owner.actor))
      }

      const roots: MessageId[] = []
      for (let index = 0; index < MESSAGES_PER_CHANNEL; index++) {
        const author = rnd.pick(members)
        const replyTo = roots.length > 0 && rnd.next() < 0.15 ? rnd.pick(roots) : undefined
        const message = yield* chat.postMessage
          .execute({
            channelId,
            body: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: sentence(rnd) }] }],
            },
            ...(replyTo === undefined ? {} : { threadRootId: replyTo }),
          })
          .pipe(Effect.provideService(CurrentActor, author.actor))
        if (replyTo === undefined && roots.length < THREAD_ROOM) roots.push(message.id)
      }
      yield* log(`channel #${channel.name}: ${MESSAGES_PER_CHANNEL} messages`)
    }
  })

/**
 * Seeds the demo workspace. Refuses when the workspace already holds content; refuses existing
 * members unless `force` is set. Never deletes data.
 */
export const seedDemo = (options: { readonly force: boolean }) =>
  Effect.gen(function* () {
    const counts = yield* readCounts
    const hasContent =
      counts.projects + counts.tasks + counts.docs + counts.messages + counts.events > 0
    if (hasContent) {
      return yield* Effect.fail(
        new SeedRefused({
          message: "The workspace already has content; `seed --demo` only fills an empty database.",
        }),
      )
    }
    if (counts.members > 0 && !options.force) {
      return yield* Effect.fail(
        new SeedRefused({
          message: "The workspace already has members. Re-run with --force to add demo data to it.",
        }),
      )
    }

    const rnd = makeRandom(SEED)
    const owner = yield* ensureOwner(counts.members)
    const people = yield* invitePeople(owner)
    const projectRefs = yield* seedProjects(owner, rnd, people)
    yield* seedCalendar(owner, rnd, people, projectRefs)
    yield* seedChannels(owner, rnd, people)
    yield* log(`done. Owner login: ${OWNER_EMAIL} / ${DEMO_PASSWORD}`)
  })
