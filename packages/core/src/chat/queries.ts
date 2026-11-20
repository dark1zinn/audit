/**
 * Chat reads: sidebar, browse, channel header, message pages, pins, threads, saved messages and the
 * admin private-read path. Normal reads are filtered by visibility; every admin read is recorded in
 * the trail as `admin.read_private`.
 */
import {
  channelKinds,
  channelMembers,
  channels,
  entities,
  messages,
  pins,
  reactions,
  references,
  savedMessages,
  threadFollowers,
  userProfiles,
} from "@audit/db/schema"
import type {
  ChannelSummary,
  ChannelHeader,
  Message,
  MessagePage,
  MessagePageQuery,
  ThreadSummary,
  ThreadView,
} from "@audit/domain/chat/schema"
import { Forbidden, NotFound } from "@audit/domain/errors"
import type { ChannelId, EntityId, MessageId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { writeTrail } from "../trail.ts"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const EMPTY_BODY = { type: "doc", content: [] }

const entityOf = (id: string): EntityId => id as EntityId

/** A channel joined with its entity version. */
export interface ChannelRow {
  readonly id: ChannelId
  readonly kind: (typeof channelKinds)[number]
  readonly name: string
  readonly topic: string
  readonly projectId: string | null
  readonly archivedAt: Date | null
  readonly dmKey: string | null
  readonly createdBy: string | null
  readonly version: number
}

/** A message joined with its entity version. */
export interface MessageRow {
  readonly id: MessageId
  readonly channelId: ChannelId
  readonly threadRootId: MessageId | null
  readonly authorId: UserId
  readonly deletedAt: Date | null
  readonly version: number
}

export const channelRow = (channelId: ChannelId): Effect.Effect<ChannelRow, NotFound, Db> =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: channels.id,
        kind: channels.kind,
        name: channels.name,
        topic: channels.topic,
        projectId: channels.projectId,
        archivedAt: channels.archivedAt,
        dmKey: channels.dmKey,
        createdBy: channels.createdBy,
        version: entities.version,
      })
      .from(channels)
      .innerJoin(entities, eq(entities.id, channels.id))
      .where(eq(channels.id, channelId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "channel", id: channelId })
    return { ...row, id: channelId }
  })

export const memberRow = (channelId: ChannelId, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        role: channelMembers.role,
        notifyLevel: channelMembers.notifyLevel,
        mutedUntil: channelMembers.mutedUntil,
        lastReadMessageId: channelMembers.lastReadMessageId,
      })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .pipe(Effect.orDie)
    return row
  })

export const memberRows = (channelId: ChannelId) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* db
      .select({
        userId: sql<UserId>`${channelMembers.userId}`,
        name: userProfiles.displayName,
        role: channelMembers.role,
        notifyLevel: channelMembers.notifyLevel,
        mutedUntil: channelMembers.mutedUntil,
      })
      .from(channelMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, channelMembers.userId))
      .where(eq(channelMembers.channelId, channelId))
      .pipe(Effect.orDie)
  })

export const messageRow = (messageId: MessageId): Effect.Effect<MessageRow, NotFound, Db> =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        threadRootId: messages.threadRootId,
        authorId: messages.authorId,
        deletedAt: messages.deletedAt,
        version: entities.version,
      })
      .from(messages)
      .innerJoin(entities, eq(entities.id, messages.id))
      .where(eq(messages.id, messageId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "message", id: messageId })
    return {
      ...row,
      id: messageId,
      channelId: row.channelId as ChannelId,
      threadRootId: row.threadRootId as MessageId | null,
      authorId: row.authorId as UserId,
    }
  })

const countOf = (
  filter: SQL | undefined,
  viewerId: UserId,
  channelId: ChannelId,
  lastRead: MessageId | null,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [unread] = yield* db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          isNull(messages.threadRootId),
          isNull(messages.deletedAt),
          ne(messages.authorId, viewerId),
          lastRead === null ? undefined : gt(messages.id, lastRead),
        ),
      )
      .pipe(Effect.orDie)
    const [mentioned] = yield* db
      .select({ n: sql<number>`count(*)::int` })
      .from(references)
      .innerJoin(messages, eq(messages.id, references.sourceId))
      .where(
        and(
          eq(references.kind, "mention"),
          eq(references.targetId, viewerId),
          eq(messages.channelId, channelId),
          lastRead === null ? undefined : gt(messages.id, lastRead),
          filter,
        ),
      )
      .pipe(Effect.orDie)
    return { unread: unread?.n ?? 0, mentions: mentioned?.n ?? 0 }
  })

const peopleOf = (channelId: ChannelId, viewerId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* db
      .select({ id: channelMembers.userId, name: userProfiles.displayName })
      .from(channelMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, channelMembers.userId))
      .where(and(eq(channelMembers.channelId, channelId), ne(channelMembers.userId, viewerId)))
      .pipe(Effect.orDie)
  })

const lastMessageAt = (channelId: ChannelId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ at: entities.createdAt })
      .from(messages)
      .innerJoin(entities, eq(entities.id, messages.id))
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(entities.createdAt))
      .limit(1)
      .pipe(Effect.orDie)
    return row?.at ?? null
  })

export const channelSummary = (channelId: ChannelId, viewerId: UserId) =>
  Effect.gen(function* () {
    const row = yield* channelRow(channelId)
    const member = yield* memberRow(channelId, viewerId)
    const lastRead = (member?.lastReadMessageId ?? null) as MessageId | null
    const isDirect = row.kind === "dm" || row.kind === "group_dm"
    const people = isDirect
      ? (yield* peopleOf(channelId, viewerId)).map((p) => ({ id: p.id as UserId, name: p.name }))
      : []
    const counts =
      member === undefined
        ? { unread: 0, mentions: 0 }
        : yield* countOf(undefined, viewerId, channelId, lastRead)
    const summary: ChannelSummary = {
      id: channelId,
      kind: row.kind,
      name: row.name,
      topic: row.topic,
      projectId: (row.projectId ?? null) as ProjectId | null,
      people,
      archivedAt: row.archivedAt,
      isMember: member !== undefined,
      notifyLevel: member?.notifyLevel ?? null,
      mutedUntil: member?.mutedUntil ?? null,
      lastReadMessageId: lastRead,
      unread: counts.unread,
      mentions: counts.mentions,
      lastMessageAt: yield* lastMessageAt(channelId),
      version: row.version,
    }
    return summary
  })

/** Channels the viewer belongs to (archived included, so the UI can show them). */
export const sidebar = (viewerId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const rows = yield* db
      .select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(eq(channelMembers.userId, viewerId))
      .pipe(Effect.orDie)
    const visible: ChannelSummary[] = []
    for (const { channelId } of rows) {
      const id = channelId as ChannelId
      if (!(yield* authz.can("channel.read", entityOf(id)))) continue
      visible.push(yield* channelSummary(id, viewerId))
    }
    return visible
  })

/** Public channels the viewer can see but may not be a member of yet. */
export const browse = (viewerId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const rows = yield* db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.kind, "public"), isNull(channels.archivedAt)))
      .orderBy(asc(channels.name))
      .pipe(Effect.orDie)
    const visible: ChannelSummary[] = []
    for (const { id } of rows) {
      const channelId = id as ChannelId
      if (!(yield* authz.can("channel.read", entityOf(channelId)))) continue
      visible.push(yield* channelSummary(channelId, viewerId))
    }
    return visible
  })

const headerOf = (channelId: ChannelId, viewerId: UserId, adminRead: boolean) =>
  Effect.gen(function* () {
    const db = yield* Db
    const members = yield* memberRows(channelId)
    const mine = yield* memberRow(channelId, viewerId)
    const [pinCount] = yield* db
      .select({ n: sql<number>`count(*)::int` })
      .from(pins)
      .where(eq(pins.channelId, channelId))
      .pipe(Effect.orDie)
    const header: ChannelHeader = {
      channel: yield* channelSummary(channelId, viewerId),
      members: members.map((m) => ({
        userId: m.userId as UserId,
        name: m.name,
        role: m.role,
        notifyLevel: m.notifyLevel,
      })),
      myRole: mine?.role ?? null,
      pinCount: pinCount?.n ?? 0,
      adminRead,
    }
    return header
  })

/** Channel header for a member or someone who can read the channel. */
export const channelHeader = (channelId: ChannelId, viewerId: UserId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("channel.read", entityOf(channelId))
    return yield* headerOf(channelId, viewerId, false)
  })

const decorate = (
  rows: ReadonlyArray<{
    id: string
    channelId: string
    threadRootId: string | null
    authorId: string
    authorName: string
    body: unknown
    bodyText: string
    editedAt: Date | null
    deletedAt: Date | null
    replyCount: number
    lastReplyAt: Date | null
    createdAt: Date
    version: number
  }>,
  viewerId: UserId,
) =>
  Effect.gen(function* () {
    if (rows.length === 0) return [] as Message[]
    const db = yield* Db
    const ids = rows.map((r) => r.id)
    const reactionRows = yield* db
      .select({
        messageId: reactions.messageId,
        emoji: reactions.emoji,
        count: sql<number>`count(*)::int`,
        mine: sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
      })
      .from(reactions)
      .where(inArray(reactions.messageId, ids))
      .groupBy(reactions.messageId, reactions.emoji)
      .pipe(Effect.orDie)
    const pinRows = yield* db
      .select({ messageId: pins.messageId })
      .from(pins)
      .where(inArray(pins.messageId, ids))
      .pipe(Effect.orDie)
    const savedRows = yield* db
      .select({ messageId: savedMessages.messageId })
      .from(savedMessages)
      .where(and(eq(savedMessages.userId, viewerId), inArray(savedMessages.messageId, ids)))
      .pipe(Effect.orDie)
    const reactionsBy = new Map<string, { emoji: string; count: number; mine: boolean }[]>()
    for (const r of reactionRows) {
      const list = reactionsBy.get(r.messageId) ?? []
      list.push({ emoji: r.emoji, count: r.count, mine: r.mine === true })
      reactionsBy.set(r.messageId, list)
    }
    const pinned = new Set(pinRows.map((r) => r.messageId))
    const saved = new Set(savedRows.map((r) => r.messageId))
    return rows.map((r): Message => ({
      id: r.id as MessageId,
      channelId: r.channelId as ChannelId,
      threadRootId: (r.threadRootId ?? null) as MessageId | null,
      author: { id: r.authorId as UserId, name: r.authorName },
      body: (r.deletedAt === null ? r.body : EMPTY_BODY) as Message["body"],
      bodyText: r.deletedAt === null ? r.bodyText : "",
      editedAt: r.editedAt,
      deletedAt: r.deletedAt,
      replyCount: r.replyCount,
      lastReplyAt: r.lastReplyAt,
      reactions: reactionsBy.get(r.id) ?? [],
      pinned: pinned.has(r.id),
      saved: saved.has(r.id),
      createdAt: r.createdAt,
      version: r.version,
    }))
  })

const loadMessages = (
  where: SQL | undefined,
  order: "asc" | "desc",
  limit: number,
  viewerId: UserId,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        threadRootId: messages.threadRootId,
        authorId: messages.authorId,
        authorName: userProfiles.displayName,
        body: messages.body,
        bodyText: messages.bodyText,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
        replyCount: messages.replyCount,
        lastReplyAt: messages.lastReplyAt,
        createdAt: entities.createdAt,
        version: entities.version,
      })
      .from(messages)
      .innerJoin(entities, eq(entities.id, messages.id))
      .innerJoin(userProfiles, eq(userProfiles.userId, messages.authorId))
      .where(where)
      .orderBy(order === "asc" ? asc(messages.id) : desc(messages.id))
      .limit(limit)
      .pipe(Effect.orDie)
    return yield* decorate(rows, viewerId)
  })

/** One page of messages under `base`, cursored by `before` / `after` (both exclusive). */
const pageOf = (
  base: SQL | undefined,
  query: MessagePageQuery,
  viewerId: UserId,
  adminRead: boolean,
) =>
  Effect.gen(function* () {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    if (query.before !== undefined) {
      const older = yield* loadMessages(
        and(base, lt(messages.id, query.before)),
        "desc",
        limit + 1,
        viewerId,
      )
      const page: MessagePage = {
        messages: older.slice(0, limit).reverse(),
        hasOlder: older.length > limit,
        hasNewer: true,
        adminRead,
      }
      return page
    }
    if (query.after !== undefined) {
      const newer = yield* loadMessages(
        and(base, gt(messages.id, query.after)),
        "asc",
        limit + 1,
        viewerId,
      )
      const page: MessagePage = {
        messages: newer.slice(0, limit),
        hasOlder: true,
        hasNewer: newer.length > limit,
        adminRead,
      }
      return page
    }
    const latest = yield* loadMessages(base, "desc", limit + 1, viewerId)
    const page: MessagePage = {
      messages: latest.slice(0, limit).reverse(),
      hasOlder: latest.length > limit,
      hasNewer: false,
      adminRead,
    }
    return page
  })

/** Top-level messages of a channel. Thread replies live in the thread view. */
const channelPage = (
  channelId: ChannelId,
  query: MessagePageQuery,
  viewerId: UserId,
  adminRead: boolean,
) =>
  pageOf(
    and(eq(messages.channelId, channelId), isNull(messages.threadRootId)),
    query,
    viewerId,
    adminRead,
  )

export const messagePage = (channelId: ChannelId, query: MessagePageQuery, viewerId: UserId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("channel.read", entityOf(channelId))
    return yield* channelPage(channelId, query, viewerId, false)
  })

export const loadMessage = (messageId: MessageId, viewerId: UserId) =>
  Effect.gen(function* () {
    const [message] = yield* loadMessages(eq(messages.id, messageId), "desc", 1, viewerId)
    if (message === undefined) return yield* new NotFound({ entity: "message", id: messageId })
    return message
  })

export const pinnedMessages = (channelId: ChannelId, viewerId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireOn("channel.read", entityOf(channelId))
    const rows = yield* db
      .select({ messageId: pins.messageId })
      .from(pins)
      .where(eq(pins.channelId, channelId))
      .orderBy(desc(pins.pinnedAt))
      .pipe(Effect.orDie)
    const ids = rows.map((r) => r.messageId as MessageId)
    const found = yield* loadMessages(inArray(messages.id, ids), "desc", ids.length, viewerId)
    const order = new Map(ids.map((id, index) => [id, index]))
    return [...found].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  })

export const saved = (viewerId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const rows = yield* db
      .select({ messageId: savedMessages.messageId })
      .from(savedMessages)
      .where(eq(savedMessages.userId, viewerId))
      .orderBy(desc(savedMessages.savedAt))
      .pipe(Effect.orDie)
    const ids = rows.map((r) => r.messageId as MessageId)
    if (ids.length === 0) return [] as Message[]
    const visible = yield* authz.visible(sql`${messages.channelId}`)
    const found = yield* loadMessages(
      and(inArray(messages.id, ids), visible),
      "desc",
      ids.length,
      viewerId,
    )
    const order = new Map(ids.map((id, index) => [id, index]))
    return [...found].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  })

/** The root of the thread a message belongs to; a root is its own thread. */
export const threadRootOf = (messageId: MessageId) =>
  Effect.gen(function* () {
    const row = yield* messageRow(messageId)
    return (row.threadRootId ?? row.id) as MessageId
  })

export const threadView = (rootId: MessageId, query: MessagePageQuery, viewerId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const rootRow = yield* messageRow(rootId)
    yield* authz.requireOn("channel.read", entityOf(rootRow.channelId))
    const [root] = yield* loadMessages(eq(messages.id, rootId), "desc", 1, viewerId)
    if (root === undefined) return yield* new NotFound({ entity: "message", id: rootId })
    const replies = yield* pageOf(eq(messages.threadRootId, rootId), query, viewerId, false)
    const [follower] = yield* db
      .select({ lastReadId: threadFollowers.lastReadId })
      .from(threadFollowers)
      .where(and(eq(threadFollowers.rootId, rootId), eq(threadFollowers.userId, viewerId)))
      .pipe(Effect.orDie)
    const view: ThreadView = {
      root,
      replies,
      following: follower !== undefined,
      lastReadId: (follower?.lastReadId ?? null) as MessageId | null,
    }
    return view
  })

/** Threads the viewer follows, most recent reply first. */
export const threads = (viewerId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const followed = yield* db
      .select({ rootId: threadFollowers.rootId, lastReadId: threadFollowers.lastReadId })
      .from(threadFollowers)
      .where(eq(threadFollowers.userId, viewerId))
      .pipe(Effect.orDie)
    const summaries: ThreadSummary[] = []
    for (const follow of followed) {
      const rootId = follow.rootId as MessageId
      const root = yield* messageRow(rootId)
      const channel = yield* channelRow(root.channelId as ChannelId)
      if (!(yield* authz.can("channel.read", entityOf(channel.id)))) continue
      const [unread] = yield* db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.threadRootId, rootId),
            ne(messages.authorId, viewerId),
            isNull(messages.deletedAt),
            follow.lastReadId === null ? undefined : gt(messages.id, follow.lastReadId),
          ),
        )
        .pipe(Effect.orDie)
      const [rootMessage] = yield* loadMessages(eq(messages.id, rootId), "desc", 1, viewerId)
      if (rootMessage === undefined) continue
      summaries.push({
        root: rootMessage,
        channelName: channel.name,
        unreadReplies: unread?.n ?? 0,
        lastReplyAt: rootMessage.lastReplyAt,
      })
    }
    return summaries.sort(
      (a, b) => (b.lastReplyAt?.getTime() ?? 0) - (a.lastReplyAt?.getTime() ?? 0),
    )
  })

/** Admin path: owners and admins read a private channel or DM they are not in. Always recorded. */
const adminAccess = (channelId: ChannelId, viewerId: UserId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("private.read")
    const row = yield* channelRow(channelId)
    if (row.kind === "public") {
      return yield* new Forbidden({
        action: "private.read",
        message: "Public channels are read through the normal channel path",
      })
    }
    const member = yield* memberRow(channelId, viewerId)
    yield* writeTrail({
      action: "admin.read_private",
      entityId: entityOf(channelId),
      entityType: "channel",
      details: { channelId, member: member !== undefined },
    })
    return member === undefined
  })

export const adminChannel = (channelId: ChannelId, viewerId: UserId) =>
  Effect.gen(function* () {
    const adminRead = yield* adminAccess(channelId, viewerId)
    return yield* headerOf(channelId, viewerId, adminRead)
  })

export const adminMessages = (channelId: ChannelId, query: MessagePageQuery, viewerId: UserId) =>
  Effect.gen(function* () {
    const adminRead = yield* adminAccess(channelId, viewerId)
    return yield* channelPage(channelId, query, viewerId, adminRead)
  })
