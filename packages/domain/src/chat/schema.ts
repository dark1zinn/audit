import { Schema } from "effect"
import {
  BoardId,
  ChannelId,
  DocId,
  EntityId,
  MessageId,
  ProjectId,
  TaskId,
  UserId,
} from "../ids.ts"
import { RichDoc } from "../tasks/schema.ts"

export const ChannelKind = Schema.Literals(["public", "private", "dm", "group_dm"])
export type ChannelKind = typeof ChannelKind.Type

export const ChannelRole = Schema.Literals(["member", "manager"])
export type ChannelRole = typeof ChannelRole.Type

export const NotifyLevel = Schema.Literals(["all", "mentions", "none"])
export type NotifyLevel = typeof NotifyLevel.Type

export const Person = Schema.Struct({ id: UserId, name: Schema.String })
export type Person = typeof Person.Type

/** A channel as the sidebar and browse lists see it, with the caller's own state. */
export const ChannelSummary = Schema.Struct({
  id: ChannelId,
  kind: ChannelKind,
  name: Schema.String,
  topic: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  /** The other people in a DM or group DM, excluding the caller. */
  people: Schema.Array(Person),
  archivedAt: Schema.NullOr(Schema.Date),
  /** Whether the caller is a member; browse lists include non-members too. */
  isMember: Schema.Boolean,
  notifyLevel: Schema.NullOr(NotifyLevel),
  mutedUntil: Schema.NullOr(Schema.Date),
  /** The caller's read position; the unread divider sits after it. */
  lastReadMessageId: Schema.NullOr(MessageId),
  unread: Schema.Int,
  mentions: Schema.Int,
  lastMessageAt: Schema.NullOr(Schema.Date),
  version: Schema.Int,
})
export type ChannelSummary = typeof ChannelSummary.Type

export const ChannelMember = Schema.Struct({
  userId: UserId,
  name: Schema.String,
  role: ChannelRole,
  notifyLevel: NotifyLevel,
})
export type ChannelMember = typeof ChannelMember.Type

/** Channel header: summary, member list and the caller's role. `adminRead` marks a private read. */
export const ChannelHeader = Schema.Struct({
  channel: ChannelSummary,
  members: Schema.Array(ChannelMember),
  myRole: Schema.NullOr(ChannelRole),
  pinCount: Schema.Int,
  adminRead: Schema.Boolean,
})
export type ChannelHeader = typeof ChannelHeader.Type

export const Reaction = Schema.Struct({
  emoji: Schema.String,
  count: Schema.Int,
  mine: Schema.Boolean,
})
export type Reaction = typeof Reaction.Type

export const Message = Schema.Struct({
  id: MessageId,
  channelId: ChannelId,
  threadRootId: Schema.NullOr(MessageId),
  author: Person,
  body: RichDoc,
  bodyText: Schema.String,
  editedAt: Schema.NullOr(Schema.Date),
  /** Set on tombstones; the body is blank then. */
  deletedAt: Schema.NullOr(Schema.Date),
  replyCount: Schema.Int,
  lastReplyAt: Schema.NullOr(Schema.Date),
  reactions: Schema.Array(Reaction),
  pinned: Schema.Boolean,
  saved: Schema.Boolean,
  createdAt: Schema.Date,
  version: Schema.Int,
})
export type Message = typeof Message.Type

/** A page of messages in UUIDv7 order (oldest first). `before`/`after` take a message id cursor. */
export const MessagePage = Schema.Struct({
  messages: Schema.Array(Message),
  hasOlder: Schema.Boolean,
  hasNewer: Schema.Boolean,
  adminRead: Schema.Boolean,
})
export type MessagePage = typeof MessagePage.Type

export const MessagePageQuery = Schema.Struct({
  before: Schema.optionalKey(MessageId),
  after: Schema.optionalKey(MessageId),
  limit: Schema.optionalKey(Schema.NumberFromString.check(Schema.isInt())),
})
export type MessagePageQuery = typeof MessagePageQuery.Type

export const ThreadView = Schema.Struct({
  root: Message,
  replies: MessagePage,
  following: Schema.Boolean,
  lastReadId: Schema.NullOr(MessageId),
})
export type ThreadView = typeof ThreadView.Type

/** A followed thread in the Threads view. */
export const ThreadSummary = Schema.Struct({
  root: Message,
  channelName: Schema.String,
  unreadReplies: Schema.Int,
  lastReplyAt: Schema.NullOr(Schema.Date),
})
export type ThreadSummary = typeof ThreadSummary.Type

// --- Inputs ----------------------------------------------------------------

export const CreateChannelInput = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["public", "private"]),
  topic: Schema.optionalKey(Schema.String),
})
export type CreateChannelInput = typeof CreateChannelInput.Type

export const UpdateChannelInput = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  topic: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.Int),
})
export type UpdateChannelInput = typeof UpdateChannelInput.Type

export const MemberIdsInput = Schema.Struct({ userIds: Schema.Array(UserId) })
export type MemberIdsInput = typeof MemberIdsInput.Type

export const OpenDmInput = Schema.Struct({ userIds: Schema.Array(UserId) })
export type OpenDmInput = typeof OpenDmInput.Type

export const PostMessageInput = Schema.Struct({
  body: RichDoc,
  threadRootId: Schema.optionalKey(Schema.NullOr(MessageId)),
})
export type PostMessageInput = typeof PostMessageInput.Type

export const EditMessageInput = Schema.Struct({
  body: RichDoc,
  version: Schema.optionalKey(Schema.Int),
})
export type EditMessageInput = typeof EditMessageInput.Type

export const EmojiInput = Schema.Struct({ emoji: Schema.String })
export type EmojiInput = typeof EmojiInput.Type

export const MarkReadInput = Schema.Struct({ messageId: MessageId })
export type MarkReadInput = typeof MarkReadInput.Type

export const SetNotifyInput = Schema.Struct({
  level: NotifyLevel,
  mutedUntil: Schema.NullOr(Schema.Date),
})
export type SetNotifyInput = typeof SetNotifyInput.Type

export const MessageToTaskInput = Schema.Struct({
  boardId: BoardId,
  title: Schema.optionalKey(Schema.String),
})
export type MessageToTaskInput = typeof MessageToTaskInput.Type

export const ThreadToDocInput = Schema.Struct({
  /** `null` creates a space doc. */
  projectId: Schema.NullOr(ProjectId),
  title: Schema.optionalKey(Schema.String),
})
export type ThreadToDocInput = typeof ThreadToDocInput.Type

/** Result of creating a task or doc from a message or thread. */
export const CreatedFromMessage = Schema.Struct({
  entityId: EntityId,
  taskId: Schema.optionalKey(TaskId),
  docId: Schema.optionalKey(DocId),
})
export type CreatedFromMessage = typeof CreatedFromMessage.Type

/** Result of the retention purge job, recorded in the trail. */
export const PurgeResult = Schema.Struct({
  purged: Schema.Int,
  kept: Schema.Int,
})
export type PurgeResult = typeof PurgeResult.Type
