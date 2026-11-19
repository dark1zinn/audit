/**
 * Chat writes: channels, DMs, membership, messages, reactions, pins, saved messages and threads.
 * Each command authorizes first, then changes rows, records the trail, emits the realtime event and
 * syncs mentions and notifications inside the same transaction.
 */
import {
  accessEntries,
  channelMembers,
  channels,
  entities,
  messages,
  pins,
  reactions,
  savedMessages,
  teamMembers,
  threadFollowers,
} from "@audit/db/schema"
import {
  ChannelSummary,
  CreateChannelInput,
  CreatedFromMessage,
  EditMessageInput,
  EmojiInput,
  MarkReadInput,
  MemberIdsInput,
  Message,
  MessageToTaskInput,
  OpenDmInput,
  PostMessageInput,
  SetNotifyInput,
  ThreadView,
  UpdateChannelInput,
} from "@audit/domain/chat/schema"
import { Conflict, Forbidden, ValidationError } from "@audit/domain/errors"
import type {
  BoardId,
  ChannelId,
  EntityId,
  MessageId,
  ProjectId,
  TaskId,
  UserId,
} from "@audit/domain/ids"
import { ChannelId as ChannelIdSchema, MessageId as MessageIdSchema } from "@audit/domain/ids"
import { extractMentions } from "@audit/editor/mentions"
import { Db } from "@audit/platform/database"
import { and, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { checkVersion, createEntity, lockEntity, touchEntity } from "../entities.ts"
import { assertWritable } from "../projects/read.ts"
import { syncReferences } from "../references.ts"
import { channelSearchText } from "../search/text.ts"
import { createTask } from "../tasks/commands.ts"
import { notify, plainText } from "../notifications/notify.ts"
import { emit, record } from "../trail.ts"
import {
  channelRow,
  channelSummary,
  loadMessage,
  memberRow,
  memberRows,
  messageRow,
  threadRootOf,
  threadView,
  type ChannelRow,
  type MessageRow,
} from "./queries.ts"

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/
const MENTION_BROADCAST_MIN = 20
const BROADCAST_TYPES: ReadonlySet<string> = new Set(["channel", "here"])
const DM_MAX = 8
const EMOJI_MAX = 32

export const entityOf = (id: string): EntityId => id as EntityId
export const invalid = (message: string, field?: string) =>
  new ValidationError(field === undefined ? { message } : { message, field })
const forbidden = (action: string, message: string) => new Forbidden({ action, message })

const requireName = (raw: string) => {
  const name = raw.trim().toLowerCase().replace(/\s+/g, "-")
  return SLUG.test(name)
    ? Effect.succeed(name)
    : Effect.fail(invalid("Channel names use lowercase letters, digits and dashes", "name"))
}

/** A unique-name clash becomes a Conflict; any other database failure stays a defect. */
const nameTaken = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Command.isUniqueViolation(error)
          ? Effect.fail(new Conflict({ message: "A channel with this name already exists" }))
          : Effect.die(error),
      onSuccess: (value) => Effect.succeed(value),
    }),
  )

const setUserGrant = (
  resourceId: ChannelId,
  userId: UserId,
  role: "commenter" | "manager",
  grantedBy: UserId,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .delete(accessEntries)
      .where(
        and(
          eq(accessEntries.resourceId, resourceId),
          eq(accessEntries.principalType, "user"),
          eq(accessEntries.principalId, userId),
        ),
      )
      .pipe(Effect.orDie)
    yield* db
      .insert(accessEntries)
      .values({
        resourceId,
        principalType: "user",
        principalId: userId,
        principalRole: null,
        role,
        grantedBy,
      })
      .pipe(Effect.orDie)
  })

const dropUserGrant = (resourceId: ChannelId, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .delete(accessEntries)
      .where(
        and(
          eq(accessEntries.resourceId, resourceId),
          eq(accessEntries.principalType, "user"),
          eq(accessEntries.principalId, userId),
        ),
      )
      .pipe(Effect.orDie)
  })

/** Public channels: owners, admins and members may comment; guests need a user grant. */
const setPublicRoleGrants = (channelId: ChannelId, grantedBy: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .delete(accessEntries)
      .where(and(eq(accessEntries.resourceId, channelId), eq(accessEntries.principalType, "role")))
      .pipe(Effect.orDie)
    yield* db
      .insert(accessEntries)
      .values(
        (["owner", "admin", "member"] as const).map((principalRole) => ({
          resourceId: channelId,
          principalType: "role" as const,
          principalId: null,
          principalRole,
          role: "commenter" as const,
          grantedBy,
        })),
      )
      .pipe(Effect.orDie)
  })

const insertMember = (channelId: ChannelId, userId: UserId, role: "member" | "manager") =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .insert(channelMembers)
      .values({ channelId, userId, role })
      .onConflictDoNothing()
      .pipe(Effect.orDie)
  })

const emitChannel = (
  channel: { id: string; projectId: string | null; version: number },
  actorId: UserId,
  kind: "created" | "updated" | "archived" | "unarchived" | "membership_changed" | "access_changed",
) =>
  emit({
    _tag: "ChannelChanged",
    entityId: entityOf(channel.id),
    projectId: (channel.projectId ?? null) as ProjectId | null,
    actorId,
    version: channel.version,
    channelId: channel.id as ChannelId,
    kind,
  })

const requireMember = (channel: ChannelRow, userId: UserId) =>
  Effect.gen(function* () {
    const member = yield* memberRow(channel.id as ChannelId, userId)
    if (member === undefined) {
      return yield* forbidden("channel.post", "Join this channel to take part")
    }
    return member
  })

/**
 * Membership for an action that needs it. Public channels join the caller on first use; private
 * channels and DMs require an existing membership.
 */
const ensureMember = (channel: ChannelRow, userId: UserId) =>
  Effect.gen(function* () {
    const member = yield* memberRow(channel.id as ChannelId, userId)
    if (member !== undefined) return member
    if (channel.kind !== "public") {
      return yield* forbidden("channel.post", "Join this channel to take part")
    }
    yield* insertMember(channel.id as ChannelId, userId, "member")
    yield* emit({
      _tag: "ChannelChanged",
      entityId: entityOf(channel.id),
      projectId: (channel.projectId ?? null) as ProjectId | null,
      actorId: userId,
      version: channel.version,
      channelId: channel.id as ChannelId,
      kind: "membership_changed",
    })
    return {
      role: "member" as const,
      notifyLevel: "mentions" as const,
      mutedUntil: null,
      lastReadMessageId: null,
    }
  })

const requireActive = (channel: ChannelRow) =>
  channel.archivedAt === null ? Effect.void : Effect.fail(invalid("This channel is archived"))

const requireNotDirect = (channel: ChannelRow, message: string) =>
  channel.kind === "dm" || channel.kind === "group_dm" ? Effect.fail(invalid(message)) : Effect.void

const requireActiveWorkspaceUser = (userId: UserId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    const role = yield* authz.workspaceRole(userId)
    if (role === null)
      return yield* invalid("Only active workspace members can be added", "userIds")
  })

// --- Channels --------------------------------------------------------------

export const createChannel = Command.make("channel.create", {
  input: CreateChannelInput,
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      if (input.kind === "public") {
        yield* authz.requireCapability("channels.create_public")
        return
      }
      const userId = yield* currentUser("channel.create")
      const role = yield* authz.workspaceRole(userId)
      if (role === null || role === "guest") {
        return yield* forbidden("channel.create", "Only members can create private channels")
      }
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("channel.create")
      const name = yield* requireName(input.name)
      const channelId = Bun.randomUUIDv7() as ChannelId
      yield* createEntity({
        id: entityOf(channelId),
        type: "channel",
        title: name,
        searchText: channelSearchText(name, input.topic ?? ""),
      })
      yield* nameTaken(
        db.insert(channels).values({
          id: channelId,
          kind: input.kind,
          projectId: null,
          name,
          topic: input.topic ?? "",
          createdBy: userId,
        }),
      )
      yield* insertMember(channelId, userId, "manager")
      if (input.kind === "public") yield* setPublicRoleGrants(channelId, userId)
      yield* setUserGrant(channelId, userId, "manager", userId)
      yield* authz.rebuild({ containerId: entityOf(channelId) })
      yield* record({
        action: "channel.created",
        entityId: entityOf(channelId),
        entityType: "channel",
        details: { kind: input.kind, name },
      })
      yield* emitChannel({ id: channelId, projectId: null, version: 1 }, userId, "created")
      return yield* channelSummary(channelId, userId)
    }),
})

/**
 * Project channel `#<key>`: created inside `createProject`'s transaction. It inherits access from
 * the project, so only the creator gets a manager grant on it.
 */
export const insertProjectChannel = (projectId: ProjectId, key: string, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const channelId = Bun.randomUUIDv7() as ChannelId
    const name = key.toLowerCase()
    yield* createEntity({
      id: entityOf(channelId),
      type: "channel",
      title: name,
      searchText: name,
      parentId: entityOf(projectId),
      projectId,
    })
    yield* nameTaken(
      db.insert(channels).values({
        id: channelId,
        kind: "public",
        projectId,
        name,
        topic: "",
        createdBy: userId,
      }),
    )
    yield* insertMember(channelId, userId, "manager")
    yield* setUserGrant(channelId, userId, "manager", userId)
    yield* authz.rebuild({ containerId: entityOf(channelId) })
    return channelId
  })

export const updateChannel = Command.make("channel.update", {
  input: Schema.Struct({ channelId: ChannelIdSchema, ...UpdateChannelInput.fields }),
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.settings", entityOf(input.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("channel.update")
      const channel = yield* channelRow(input.channelId)
      yield* requireActive(channel)
      const lock = yield* lockEntity(entityOf(input.channelId), "channel")
      yield* checkVersion(lock, input.version, { channel: input.channelId })
      let name = channel.name
      if (input.name !== undefined) {
        yield* requireNotDirect(channel, "Direct message names cannot change")
        name = yield* requireName(input.name)
      }
      yield* nameTaken(
        db
          .update(channels)
          .set({ name, topic: input.topic ?? channel.topic })
          .where(eq(channels.id, input.channelId)),
      )
      if (name !== channel.name) {
        yield* db
          .update(entities)
          .set({ title: name })
          .where(eq(entities.id, entityOf(input.channelId)))
          .pipe(Effect.orDie)
      }
      const version = yield* touchEntity(entityOf(input.channelId), {
        searchText: channelSearchText(name, input.topic ?? channel.topic),
      })
      yield* record({
        action: "channel.updated",
        entityId: entityOf(input.channelId),
        entityType: "channel",
        details: { name, topic: input.topic ?? channel.topic },
      })
      yield* emitChannel(
        { id: input.channelId, projectId: channel.projectId, version },
        userId,
        "updated",
      )
      return yield* channelSummary(input.channelId, userId)
    }),
})

const setArchived = (channelId: ChannelId, archive: boolean) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser(archive ? "channel.archive" : "channel.unarchive")
    const channel = yield* channelRow(channelId)
    if ((channel.archivedAt !== null) === archive) {
      return yield* invalid(archive ? "Channel is already archived" : "Channel is not archived")
    }
    yield* db
      .update(channels)
      .set({ archivedAt: archive ? new Date() : null })
      .where(eq(channels.id, channelId))
      .pipe(Effect.orDie)
    const version = yield* touchEntity(entityOf(channelId))
    yield* record({
      action: archive ? "channel.archived" : "channel.unarchived",
      entityId: entityOf(channelId),
      entityType: "channel",
      details: {},
    })
    yield* emitChannel(
      { id: channelId, projectId: channel.projectId, version },
      userId,
      archive ? "archived" : "unarchived",
    )
    return yield* channelSummary(channelId, userId)
  })

const channelIdInput = Schema.Struct({ channelId: ChannelIdSchema })

export const archiveChannel = Command.make("channel.archive", {
  input: channelIdInput,
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.archive", entityOf(input.channelId))
    }),
  run: (input) => setArchived(input.channelId, true),
})

export const unarchiveChannel = Command.make("channel.unarchive", {
  input: channelIdInput,
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.archive", entityOf(input.channelId))
    }),
  run: (input) => setArchived(input.channelId, false),
})

export const joinChannel = Command.make("channel.join", {
  input: channelIdInput,
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.read", entityOf(input.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("channel.join")
      const channel = yield* channelRow(input.channelId)
      yield* requireActive(channel)
      if (channel.kind !== "public") {
        return yield* forbidden("channel.join", "Only a manager can add you to this channel")
      }
      if ((yield* memberRow(input.channelId, userId)) === undefined) {
        yield* insertMember(input.channelId, userId, "member")
        yield* emitChannel(channel, userId, "membership_changed")
      }
      return yield* channelSummary(input.channelId, userId)
    }),
})

export const leaveChannel = Command.make("channel.leave", {
  input: channelIdInput,
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.read", entityOf(input.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("channel.leave")
      const channel = yield* channelRow(input.channelId)
      if ((yield* memberRow(input.channelId, userId)) !== undefined) {
        yield* db
          .delete(channelMembers)
          .where(
            and(eq(channelMembers.channelId, input.channelId), eq(channelMembers.userId, userId)),
          )
          .pipe(Effect.orDie)
        if (channel.kind !== "public") yield* dropUserGrant(input.channelId, userId)
        yield* authz.rebuild({ containerId: entityOf(input.channelId) })
        yield* emitChannel(channel, userId, "membership_changed")
      }
      return yield* channelSummary(input.channelId, userId)
    }),
})

export const addMembers = Command.make("channel.members.add", {
  input: Schema.Struct({ channelId: ChannelIdSchema, ...MemberIdsInput.fields }),
  output: Schema.Struct({ channelId: ChannelIdSchema }),
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.settings", entityOf(input.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const userId = yield* currentUser("channel.members.add")
      const channel = yield* channelRow(input.channelId)
      yield* requireActive(channel)
      yield* requireNotDirect(channel, "Direct messages have fixed members")
      for (const memberId of input.userIds) {
        yield* requireActiveWorkspaceUser(memberId)
        if ((yield* memberRow(input.channelId, memberId)) !== undefined) continue
        yield* insertMember(input.channelId, memberId, "member")
        yield* setUserGrant(input.channelId, memberId, "commenter", userId)
      }
      yield* authz.rebuild({ containerId: entityOf(input.channelId) })
      yield* record({
        action: "channel.members.added",
        entityId: entityOf(input.channelId),
        entityType: "channel",
        details: { userIds: input.userIds },
      })
      yield* emitChannel(channel, userId, "membership_changed")
      return { channelId: input.channelId }
    }),
})

export const removeMember = Command.make("channel.members.remove", {
  input: Schema.Struct({ channelId: ChannelIdSchema, ...MemberIdsInput.fields }),
  output: Schema.Struct({ channelId: ChannelIdSchema }),
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.settings", entityOf(input.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("channel.members.remove")
      const channel = yield* channelRow(input.channelId)
      yield* requireNotDirect(channel, "Direct messages have fixed members")
      for (const memberId of input.userIds) {
        yield* db
          .delete(channelMembers)
          .where(
            and(eq(channelMembers.channelId, input.channelId), eq(channelMembers.userId, memberId)),
          )
          .pipe(Effect.orDie)
        if (channel.kind !== "public") yield* dropUserGrant(input.channelId, memberId)
      }
      yield* authz.rebuild({ containerId: entityOf(input.channelId) })
      yield* record({
        action: "channel.members.removed",
        entityId: entityOf(input.channelId),
        entityType: "channel",
        details: { userIds: input.userIds },
      })
      yield* emitChannel(channel, userId, "membership_changed")
      return { channelId: input.channelId }
    }),
})

export const setNotify = Command.make("channel.notify", {
  input: Schema.Struct({ channelId: ChannelIdSchema, ...SetNotifyInput.fields }),
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.read", entityOf(input.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("channel.notify")
      const channel = yield* channelRow(input.channelId)
      yield* requireMember(channel, userId)
      yield* db
        .update(channelMembers)
        .set({ notifyLevel: input.level, mutedUntil: input.mutedUntil })
        .where(
          and(eq(channelMembers.channelId, input.channelId), eq(channelMembers.userId, userId)),
        )
        .pipe(Effect.orDie)
      yield* emit({
        _tag: "ReadStateChanged",
        entityId: null,
        projectId: null,
        actorId: userId,
        version: null,
        userId,
        channelId: input.channelId,
        kind: "muted_changed",
      })
      return yield* channelSummary(input.channelId, userId)
    }),
})

export const markRead = Command.make("channel.read_state", {
  input: Schema.Struct({ channelId: ChannelIdSchema, ...MarkReadInput.fields }),
  output: ChannelSummary,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("channel.read", entityOf(input.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("channel.read_state")
      const channel = yield* channelRow(input.channelId)
      yield* requireMember(channel, userId)
      const message = yield* messageRow(input.messageId)
      if (message.channelId !== input.channelId) {
        return yield* invalid("That message is not in this channel", "messageId")
      }
      yield* db
        .update(channelMembers)
        .set({
          lastReadMessageId: sql`greatest(${channelMembers.lastReadMessageId}, ${input.messageId}::uuid)`,
        })
        .where(
          and(eq(channelMembers.channelId, input.channelId), eq(channelMembers.userId, userId)),
        )
        .pipe(Effect.orDie)
      yield* emit({
        _tag: "ReadStateChanged",
        entityId: null,
        projectId: null,
        actorId: userId,
        version: null,
        userId,
        channelId: input.channelId,
        kind: "read",
      })
      return yield* channelSummary(input.channelId, userId)
    }),
})

// --- Direct messages -------------------------------------------------------

export const openDm = Command.make("dm.open", {
  input: OpenDmInput,
  output: ChannelSummary,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("dm.open")
      const everyone = [...new Set<string>([userId, ...input.userIds])].sort()
      if (everyone.length < 2) return yield* invalid("Pick at least one other person", "userIds")
      if (everyone.length > DM_MAX) {
        return yield* invalid(`A group message has at most ${DM_MAX} people`, "userIds")
      }
      for (const memberId of everyone) {
        yield* requireActiveWorkspaceUser(memberId as UserId)
      }
      const dmKey = everyone.join(",")
      const [existing] = yield* db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.dmKey, dmKey))
        .pipe(Effect.orDie)
      if (existing !== undefined) {
        const channelId = existing.id as ChannelId
        if ((yield* memberRow(channelId, userId)) === undefined) {
          yield* insertMember(channelId, userId, "member")
          yield* setUserGrant(channelId, userId, "commenter", userId)
          yield* authz.rebuild({ containerId: entityOf(channelId) })
        }
        return yield* channelSummary(channelId, userId)
      }
      const channelId = Bun.randomUUIDv7() as ChannelId
      const kind = everyone.length === 2 ? "dm" : "group_dm"
      yield* createEntity({ id: entityOf(channelId), type: "channel", title: "" })
      yield* db
        .insert(channels)
        .values({
          id: channelId,
          kind,
          projectId: null,
          name: "",
          topic: "",
          dmKey,
          createdBy: userId,
        })
        .pipe(Effect.orDie)
      for (const memberId of everyone) {
        const isCreator = memberId === userId
        yield* insertMember(channelId, memberId as UserId, isCreator ? "manager" : "member")
        yield* setUserGrant(
          channelId,
          memberId as UserId,
          isCreator ? "manager" : "commenter",
          userId,
        )
      }
      yield* authz.rebuild({ containerId: entityOf(channelId) })
      yield* record({
        action: "dm.opened",
        entityId: entityOf(channelId),
        entityType: "channel",
        details: { kind, people: everyone.length },
      })
      yield* emit({
        _tag: "ChannelChanged",
        entityId: entityOf(channelId),
        projectId: null,
        actorId: userId,
        version: 1,
        channelId,
        kind: "created",
      })
      return yield* channelSummary(channelId, userId)
    }),
})

// --- Messages --------------------------------------------------------------

type MentionTarget = { readonly id: string; readonly type: string; readonly snippet: string }

/**
 * Syncs mention references for a message and notifies the people it newly mentions: a person, the
 * members of a mentioned team, and on creation every member for `@channel`/`@here`. `notify` only
 * writes for recipients who can see the channel, so the returned set is who was actually notified.
 */
const syncMentions = (
  message: { id: MessageId; channelId: ChannelId; projectId: ProjectId | null },
  body: unknown,
  actorId: UserId,
  created: boolean,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const mentions: ReadonlyArray<MentionTarget> = extractMentions(body)
    const members = yield* memberRows(message.channelId)
    const broadcast = mentions.some((m) => BROADCAST_TYPES.has(m.type))
    if (broadcast && members.length > MENTION_BROADCAST_MIN) {
      const actor = members.find((m) => m.userId === actorId)
      if (actor?.role !== "manager") {
        return yield* invalid(
          `@channel and @here need a channel manager in channels with more than ${MENTION_BROADCAST_MIN} members`,
          "body",
        )
      }
    }
    const refs = mentions.filter((m) => !BROADCAST_TYPES.has(m.type))
    const added = new Set(
      (yield* syncReferences(
        entityOf(message.id),
        "mention",
        refs.map((m) => ({ targetId: entityOf(m.id), snippet: m.snippet })),
      )).map(String),
    )
    const targets = new Set<string>()
    for (const m of refs) {
      if (!added.has(m.id)) continue
      if (m.type === "user") targets.add(m.id)
      if (m.type === "team") {
        const rows = yield* db
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, m.id))
          .pipe(Effect.orDie)
        for (const row of rows) targets.add(row.userId)
      }
    }
    if (broadcast && created) for (const m of members) targets.add(m.userId)
    const byId = new Map(members.map((m) => [m.userId, m]))
    const notified = new Set<string>()
    for (const target of targets) {
      if (target === actorId || byId.get(target as UserId)?.notifyLevel === "none") continue
      const written = yield* notify({
        userId: target as UserId,
        kind: "mention",
        entityId: entityOf(message.id),
        projectId: message.projectId,
        actorId,
        payload: { channelId: message.channelId },
        groupKey: `mention:${message.id}`,
      })
      if (written) notified.add(target)
    }
    return notified
  })

/** A follower or DM member gets a ping only when they chose every message, and not while muted. */
const wantsEveryMessage = (
  member: { notifyLevel: string; mutedUntil: Date | null } | undefined,
  now: Date,
) =>
  member === undefined
    ? true
    : member.notifyLevel === "all" && (member.mutedUntil === null || member.mutedUntil <= now)

const postMessageRun = (input: Schema.Schema.Type<typeof PostMessageInput>, channelId: ChannelId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser("message.post")
    const channel = yield* channelRow(channelId)
    yield* requireActive(channel)
    if (channel.projectId !== null) yield* assertWritable(channel.projectId as ProjectId)
    yield* ensureMember(channel, userId)
    const bodyText = plainText(input.body).trim()
    if (bodyText === "") return yield* invalid("Message is empty", "body")
    let root: MessageRow | null = null
    if (input.threadRootId) {
      const candidate = yield* messageRow(input.threadRootId)
      if (candidate.channelId !== channelId || candidate.threadRootId !== null) {
        return yield* invalid("Replies go to a top-level message in this channel", "threadRootId")
      }
      root = candidate
    }
    const messageId = Bun.randomUUIDv7() as MessageId
    yield* createEntity({
      id: entityOf(messageId),
      type: "message",
      title: "",
      searchText: bodyText,
      parentId: entityOf(channelId),
      projectId: channel.projectId as ProjectId | null,
    })
    yield* db
      .insert(messages)
      .values({
        id: messageId,
        channelId,
        threadRootId: root?.id ?? null,
        authorId: userId,
        body: input.body,
        bodyText,
      })
      .pipe(Effect.orDie)
    if (root === null) {
      // Your own message is never unread for you.
      yield* db
        .update(channelMembers)
        .set({
          lastReadMessageId: sql`greatest(${channelMembers.lastReadMessageId}, ${messageId}::uuid)`,
        })
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
        .pipe(Effect.orDie)
    }
    if (root !== null) {
      yield* db
        .update(messages)
        .set({ replyCount: sql`${messages.replyCount} + 1`, lastReplyAt: new Date() })
        .where(eq(messages.id, root.id))
        .pipe(Effect.orDie)
      yield* db
        .insert(threadFollowers)
        .values({ rootId: root.id, userId: root.authorId, lastReadId: null })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
      yield* db
        .insert(threadFollowers)
        .values({ rootId: root.id, userId, lastReadId: messageId })
        .onConflictDoUpdate({
          target: [threadFollowers.rootId, threadFollowers.userId],
          set: { lastReadId: messageId },
        })
        .pipe(Effect.orDie)
    }
    const projectId = channel.projectId as ProjectId | null
    const notified = yield* syncMentions(
      { id: messageId, channelId, projectId },
      input.body,
      userId,
      true,
    )
    const members = yield* memberRows(channelId)
    const byId = new Map(members.map((m) => [m.userId, m]))
    const now = new Date()
    const preview = bodyText.slice(0, 120)
    if (channel.kind === "dm" || channel.kind === "group_dm") {
      for (const member of members) {
        if (member.userId === userId || notified.has(member.userId)) continue
        if (!wantsEveryMessage(member, now)) continue
        yield* notify({
          userId: member.userId,
          kind: "direct_message",
          entityId: entityOf(messageId),
          projectId: null,
          actorId: userId,
          payload: { channelId, preview },
          groupKey: `dm:${channelId}`,
        })
      }
    }
    if (root !== null) {
      const followers = yield* db
        .select({ userId: sql<UserId>`${threadFollowers.userId}` })
        .from(threadFollowers)
        .where(eq(threadFollowers.rootId, root.id))
        .pipe(Effect.orDie)
      for (const { userId: followerId } of followers) {
        if (followerId === userId || notified.has(followerId)) continue
        if (!wantsEveryMessage(byId.get(followerId), now)) continue
        yield* notify({
          userId: followerId,
          kind: "thread_reply",
          entityId: entityOf(messageId),
          projectId,
          actorId: userId,
          payload: { channelId, rootId: root.id, preview },
          groupKey: `thread:${root.id}`,
        })
      }
    }
    yield* record({
      action: root === null ? "message.created" : "message.replied",
      entityId: entityOf(messageId),
      entityType: "message",
      details: { channelId, threadRootId: root?.id ?? null },
    })
    yield* emit({
      _tag: "MessageChanged",
      entityId: entityOf(messageId),
      projectId,
      actorId: userId,
      version: 1,
      channelId,
      messageId,
      kind: root === null ? "created" : "thread_reply",
    })
    return yield* loadMessage(messageId, userId)
  })

export const postMessage = Command.make("message.post", {
  input: Schema.Struct({ channelId: ChannelIdSchema, ...PostMessageInput.fields }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.post", entityOf(input.channelId))
    }),
  run: (input) => postMessageRun(input, input.channelId),
})

export const editMessage = Command.make("message.edit", {
  input: Schema.Struct({ messageId: MessageIdSchema, ...EditMessageInput.fields }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const userId = yield* currentUser("message.edit")
      const message = yield* messageRow(input.messageId)
      if (message.authorId !== userId) {
        return yield* forbidden("message.edit", "Only the author can edit a message")
      }
      yield* authz.requireOn("message.post", entityOf(message.channelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("message.edit")
      const message = yield* messageRow(input.messageId)
      if (message.deletedAt !== null) return yield* invalid("Deleted messages cannot be edited")
      const channel = yield* channelRow(message.channelId as ChannelId)
      yield* requireActive(channel)
      const lock = yield* lockEntity(entityOf(input.messageId), "message")
      yield* checkVersion(lock, input.version, { message: input.messageId })
      const bodyText = plainText(input.body).trim()
      if (bodyText === "") return yield* invalid("Message is empty", "body")
      yield* db
        .update(messages)
        .set({ body: input.body, bodyText, editedAt: new Date() })
        .where(eq(messages.id, input.messageId))
        .pipe(Effect.orDie)
      yield* syncMentions(
        {
          id: input.messageId,
          channelId: message.channelId as ChannelId,
          projectId: channel.projectId as ProjectId | null,
        },
        input.body,
        userId,
        false,
      )
      const version = yield* touchEntity(entityOf(input.messageId), { searchText: bodyText })
      yield* record({
        action: "message.edited",
        entityId: entityOf(input.messageId),
        entityType: "message",
        details: { channelId: message.channelId },
      })
      yield* emit({
        _tag: "MessageChanged",
        entityId: entityOf(input.messageId),
        projectId: (channel.projectId ?? null) as ProjectId | null,
        actorId: userId,
        version,
        channelId: message.channelId as ChannelId,
        messageId: input.messageId,
        kind: "edited",
      })
      return yield* loadMessage(input.messageId, userId)
    }),
})

export const deleteMessage = Command.make("message.delete", {
  input: Schema.Struct({ messageId: MessageIdSchema }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.read", entityOf(input.messageId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("message.delete")
      const message = yield* messageRow(input.messageId)
      if (message.deletedAt !== null) return yield* invalid("Message is already deleted")
      const channel = yield* channelRow(message.channelId as ChannelId)
      if (message.authorId !== userId) {
        const member = yield* memberRow(message.channelId as ChannelId, userId)
        if (member?.role !== "manager") {
          return yield* forbidden(
            "message.delete",
            "Only the author or a channel manager can delete",
          )
        }
      }
      yield* db
        .update(messages)
        .set({ deletedAt: new Date(), body: { type: "doc", content: [] }, bodyText: "" })
        .where(eq(messages.id, input.messageId))
        .pipe(Effect.orDie)
      yield* db.delete(reactions).where(eq(reactions.messageId, input.messageId)).pipe(Effect.orDie)
      yield* db.delete(pins).where(eq(pins.messageId, input.messageId)).pipe(Effect.orDie)
      yield* db
        .delete(savedMessages)
        .where(eq(savedMessages.messageId, input.messageId))
        .pipe(Effect.orDie)
      yield* syncReferences(entityOf(input.messageId), "mention", [])
      const version = yield* touchEntity(entityOf(input.messageId))
      yield* record({
        action: "message.deleted",
        entityId: entityOf(input.messageId),
        entityType: "message",
        details: { channelId: message.channelId },
      })
      yield* emit({
        _tag: "MessageChanged",
        entityId: entityOf(input.messageId),
        projectId: (channel.projectId ?? null) as ProjectId | null,
        actorId: userId,
        version,
        channelId: message.channelId as ChannelId,
        messageId: input.messageId,
        kind: "deleted",
      })
      return yield* loadMessage(input.messageId, userId)
    }),
})

const reactionEvent = (
  message: MessageRow,
  channel: ChannelRow,
  userId: UserId,
  messageId: MessageId,
) =>
  emit({
    _tag: "MessageChanged",
    entityId: entityOf(messageId),
    projectId: (channel.projectId ?? null) as ProjectId | null,
    actorId: userId,
    version: message.version,
    channelId: message.channelId as ChannelId,
    messageId,
    kind: "reaction_changed",
  })

export const addReaction = Command.make("message.react", {
  input: Schema.Struct({ messageId: MessageIdSchema, ...EmojiInput.fields }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.react", entityOf(input.messageId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("message.react")
      const message = yield* messageRow(input.messageId)
      if (message.deletedAt !== null) return yield* invalid("Deleted messages cannot be reacted to")
      const channel = yield* channelRow(message.channelId as ChannelId)
      yield* ensureMember(channel, userId)
      const emoji = input.emoji.trim()
      if (emoji === "" || emoji.length > EMOJI_MAX) return yield* invalid("Pick an emoji", "emoji")
      yield* db
        .insert(reactions)
        .values({ messageId: input.messageId, userId, emoji })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
      yield* reactionEvent(message, channel, userId, input.messageId)
      return yield* loadMessage(input.messageId, userId)
    }),
})

export const removeReaction = Command.make("message.unreact", {
  input: Schema.Struct({ messageId: MessageIdSchema, ...EmojiInput.fields }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.react", entityOf(input.messageId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("message.unreact")
      const message = yield* messageRow(input.messageId)
      const channel = yield* channelRow(message.channelId as ChannelId)
      yield* db
        .delete(reactions)
        .where(
          and(
            eq(reactions.messageId, input.messageId),
            eq(reactions.userId, userId),
            eq(reactions.emoji, input.emoji.trim()),
          ),
        )
        .pipe(Effect.orDie)
      yield* reactionEvent(message, channel, userId, input.messageId)
      return yield* loadMessage(input.messageId, userId)
    }),
})

const pinOrUnpin = (messageId: MessageId, pin: boolean) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser(pin ? "message.pin" : "message.unpin")
    const message = yield* messageRow(messageId)
    if (message.deletedAt !== null) return yield* invalid("Deleted messages cannot be pinned")
    const channel = yield* channelRow(message.channelId as ChannelId)
    yield* ensureMember(channel, userId)
    if (pin) {
      yield* db
        .insert(pins)
        .values({
          channelId: message.channelId as ChannelId,
          messageId,
          pinnedBy: userId,
          pinnedAt: new Date(),
        })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
    } else {
      yield* db
        .delete(pins)
        .where(
          and(eq(pins.messageId, messageId), eq(pins.channelId, message.channelId as ChannelId)),
        )
        .pipe(Effect.orDie)
    }
    yield* record({
      action: pin ? "message.pinned" : "message.unpinned",
      entityId: entityOf(messageId),
      entityType: "message",
      details: { channelId: message.channelId },
    })
    yield* emit({
      _tag: "MessageChanged",
      entityId: entityOf(messageId),
      projectId: (channel.projectId ?? null) as ProjectId | null,
      actorId: userId,
      version: message.version,
      channelId: message.channelId as ChannelId,
      messageId,
      kind: pin ? "pinned" : "unpinned",
    })
    return yield* loadMessage(messageId, userId)
  })

export const pinMessage = Command.make("message.pin", {
  input: Schema.Struct({ messageId: MessageIdSchema }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.post", entityOf(input.messageId))
    }),
  run: (input) => pinOrUnpin(input.messageId, true),
})

export const unpinMessage = Command.make("message.unpin", {
  input: Schema.Struct({ messageId: MessageIdSchema }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.post", entityOf(input.messageId))
    }),
  run: (input) => pinOrUnpin(input.messageId, false),
})

const saveOrUnsave = (messageId: MessageId, save: boolean) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser(save ? "message.save" : "message.unsave")
    yield* messageRow(messageId)
    if (save) {
      yield* db
        .insert(savedMessages)
        .values({ userId, messageId, savedAt: new Date() })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
    } else {
      yield* db
        .delete(savedMessages)
        .where(and(eq(savedMessages.userId, userId), eq(savedMessages.messageId, messageId)))
        .pipe(Effect.orDie)
    }
    return yield* loadMessage(messageId, userId)
  })

export const saveMessage = Command.make("message.save", {
  input: Schema.Struct({ messageId: MessageIdSchema }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.read", entityOf(input.messageId))
    }),
  run: (input) => saveOrUnsave(input.messageId, true),
})

export const unsaveMessage = Command.make("message.unsave", {
  input: Schema.Struct({ messageId: MessageIdSchema }),
  output: Message,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.read", entityOf(input.messageId))
    }),
  run: (input) => saveOrUnsave(input.messageId, false),
})

export const messageToTask = Command.make("message.to_task", {
  input: Schema.Struct({ messageId: MessageIdSchema, ...MessageToTaskInput.fields }),
  output: CreatedFromMessage,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("message.read", entityOf(input.messageId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("message.to_task")
      const message = yield* messageRow(input.messageId)
      if (message.deletedAt !== null) return yield* invalid("Deleted messages cannot become tasks")
      const body = yield* db
        .select({ body: messages.body, bodyText: messages.bodyText })
        .from(messages)
        .where(eq(messages.id, input.messageId))
        .pipe(Effect.orDie)
      const [source] = body
      if (source === undefined) return yield* invalid("Message not found", "messageId")
      const fallback = source.bodyText.trim().slice(0, 200)
      const title = (input.title?.trim() || fallback || "Message from chat").slice(0, 300)
      const task = yield* createTask.execute({
        boardId: input.boardId as BoardId,
        title,
        description: source.body as never,
      })
      const taskId = task.id as string as TaskId
      yield* syncReferences(entityOf(input.messageId), "link", [{ targetId: entityOf(taskId) }])
      yield* record({
        action: "message.to_task",
        entityId: entityOf(input.messageId),
        entityType: "message",
        details: { taskId, by: userId },
      })
      return { entityId: entityOf(taskId), taskId }
    }),
})

// --- Threads ---------------------------------------------------------------

export const threadAuthorize = (messageId: MessageId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("message.read", entityOf(messageId))
  })

const threadEvent = (
  channelId: ChannelId,
  userId: UserId,
  kind: "thread_followed" | "thread_unfollowed" | "read",
) =>
  emit({
    _tag: "ReadStateChanged",
    entityId: null,
    projectId: null,
    actorId: userId,
    version: null,
    userId,
    channelId,
    kind,
  })

export const followThread = Command.make("thread.follow", {
  input: Schema.Struct({ messageId: MessageIdSchema }),
  output: ThreadView,
  authorize: (input) => threadAuthorize(input.messageId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("thread.follow")
      const rootId = yield* threadRootOf(input.messageId)
      const root = yield* messageRow(rootId)
      yield* db
        .insert(threadFollowers)
        .values({ rootId, userId, lastReadId: null })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
      yield* threadEvent(root.channelId as ChannelId, userId, "thread_followed")
      return yield* threadView(rootId, {}, userId)
    }),
})

export const unfollowThread = Command.make("thread.unfollow", {
  input: Schema.Struct({ messageId: MessageIdSchema }),
  output: ThreadView,
  authorize: (input) => threadAuthorize(input.messageId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("thread.unfollow")
      const rootId = yield* threadRootOf(input.messageId)
      const root = yield* messageRow(rootId)
      yield* db
        .delete(threadFollowers)
        .where(and(eq(threadFollowers.rootId, rootId), eq(threadFollowers.userId, userId)))
        .pipe(Effect.orDie)
      yield* threadEvent(root.channelId as ChannelId, userId, "thread_unfollowed")
      return yield* threadView(rootId, {}, userId)
    }),
})

export const threadMarkRead = Command.make("thread.read", {
  input: MarkReadInput,
  output: ThreadView,
  authorize: (input) => threadAuthorize(input.messageId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("thread.read")
      const rootId = yield* threadRootOf(input.messageId)
      const root = yield* messageRow(rootId)
      const target = yield* messageRow(input.messageId)
      if ((target.threadRootId ?? target.id) !== rootId) {
        return yield* invalid("That message is not in this thread", "messageId")
      }
      yield* db
        .insert(threadFollowers)
        .values({ rootId, userId, lastReadId: input.messageId })
        .onConflictDoUpdate({
          target: [threadFollowers.rootId, threadFollowers.userId],
          set: {
            lastReadId: sql`greatest(${threadFollowers.lastReadId}, ${input.messageId}::uuid)`,
          },
        })
        .pipe(Effect.orDie)
      yield* threadEvent(root.channelId as ChannelId, userId, "read")
      return yield* threadView(rootId, {}, userId)
    }),
})
