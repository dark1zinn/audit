import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth.ts"
import { entityPk, timestamptz } from "./columns.ts"
import { entities, projects } from "./core.ts"

const inList = (column: AnyPgColumn, values: ReadonlyArray<string>) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`

export const channelKinds = ["public", "private", "dm", "group_dm"] as const
export const channelMemberRoles = ["member", "manager"] as const
export const notifyLevels = ["all", "mentions", "none"] as const

/**
 * A channel's entity id is its access container. DMs and group DMs have no name; `dm_key` holds the
 * sorted member ids so a pair of people has exactly one DM.
 */
export const channels = pgTable(
  "channels",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<(typeof channelKinds)[number]>(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    topic: text("topic").notNull().default(""),
    dmKey: text("dm_key").unique(),
    createdBy: uuid("created_by").references(() => user.id),
    archivedAt: timestamptz("archived_at"),
  },
  (t) => [
    check("channels_kind_check", inList(t.kind, channelKinds)),
    check(
      "channels_dm_key_check",
      sql`(${t.kind} in ('dm', 'group_dm')) = (${t.dmKey} is not null)`,
    ),
    uniqueIndex("channels_name_uq")
      .on(t.name)
      .where(sql`${t.kind} in ('public', 'private')`),
    index("channels_project_idx").on(t.projectId),
  ],
)

export const channelMembers = pgTable(
  "channel_members",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<(typeof channelMemberRoles)[number]>().default("member"),
    lastReadMessageId: uuid("last_read_message_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    notifyLevel: text("notify_level")
      .notNull()
      .$type<(typeof notifyLevels)[number]>()
      .default("mentions"),
    mutedUntil: timestamptz("muted_until"),
    joinedAt: timestamptz("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index("channel_members_user_idx").on(t.userId),
    check("channel_members_role_check", inList(t.role, channelMemberRoles)),
    check("channel_members_notify_check", inList(t.notifyLevel, notifyLevels)),
  ],
)

/** A message is an entity under its channel. Thread replies also carry their root's id. */
export const messages = pgTable(
  "messages",
  {
    id: entityPk().references(() => entities.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    threadRootId: uuid("thread_root_id").references((): AnyPgColumn => messages.id, {
      onDelete: "cascade",
    }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    body: jsonb("body").notNull().$type<Record<string, unknown>>(),
    bodyText: text("body_text").notNull().default(""),
    editedAt: timestamptz("edited_at"),
    /** Tombstone: the row stays so replies and pins keep their anchor; the body is blank. */
    deletedAt: timestamptz("deleted_at"),
    replyCount: integer("reply_count").notNull().default(0),
    lastReplyAt: timestamptz("last_reply_at"),
    /** Set on messages the workspace AI wrote (weekly digest); shown with an AI label. */
    generatedBy: text("generated_by"),
  },
  (t) => [
    index("messages_channel_idx").on(t.channelId, t.id.desc()),
    index("messages_thread_idx").on(t.threadRootId, t.id),
  ],
)

export const reactions = pgTable(
  "reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
)

export const pins = pgTable(
  "pins",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    pinnedBy: uuid("pinned_by")
      .notNull()
      .references(() => user.id),
    pinnedAt: timestamptz("pinned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.messageId] })],
)

/** Users following a thread; `last_read_id` is the newest reply they have seen. */
export const threadFollowers = pgTable(
  "thread_followers",
  {
    rootId: uuid("root_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastReadId: uuid("last_read_id").references(() => messages.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.rootId, t.userId] }),
    index("thread_followers_user_idx").on(t.userId),
  ],
)

export const savedMessages = pgTable(
  "saved_messages",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    savedAt: timestamptz("saved_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] })],
)
