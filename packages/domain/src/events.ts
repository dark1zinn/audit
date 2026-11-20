/**
 * Domain events, published after a command commits. Consumers: realtime fan-out, notifications,
 * search indexing, embeddings and AI doc upkeep. Each feature adds its events to `DomainEvent`.
 */
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Unauthorized } from "./errors.ts"
import { RpcAuthentication } from "./http.ts"
import {
  BoardId,
  ChannelId,
  ColumnId,
  DocId,
  EntityId,
  MessageId,
  NotificationId,
  ProjectId,
  TaskId,
  CalendarId,
  EventId,
  UserId,
} from "./ids.ts"
import { ColumnCategory, ProjectVisibility } from "./projects/schema.ts"
import { Priority } from "./tasks/schema.ts"

/** Fields every event carries so fan-out can filter by scope and permission. */
const base = {
  /** Entity the event is about; permission checks use it. `null` for workspace-level events. */
  entityId: Schema.NullOr(EntityId),
  projectId: Schema.NullOr(ProjectId),
  actorId: Schema.NullOr(UserId),
  /** New entity version for optimistic concurrency, when the entity has one. */
  version: Schema.NullOr(Schema.Int),
}

export const MembersChanged = Schema.TaggedStruct("MembersChanged", {
  ...base,
  userId: UserId,
})
export const InvitesChanged = Schema.TaggedStruct("InvitesChanged", base)
export const TeamsChanged = Schema.TaggedStruct("TeamsChanged", base)
export const WorkspaceUpdated = Schema.TaggedStruct("WorkspaceUpdated", base)
export const ProfileUpdated = Schema.TaggedStruct("ProfileUpdated", { ...base, userId: UserId })

/** Project lifecycle, access and settings. `entityId` is the project id. */
export const ProjectChanged = Schema.TaggedStruct("ProjectChanged", {
  ...base,
  kind: Schema.Literals([
    "created",
    "updated",
    "archived",
    "unarchived",
    "deleted",
    "restored",
    "access_changed",
  ]),
  key: Schema.String,
  visibility: ProjectVisibility,
})

/** Boards, columns and labels. `entityId` is the board id (labels use the project id). */
export const BoardChanged = Schema.TaggedStruct("BoardChanged", {
  ...base,
  kind: Schema.Literals([
    "created",
    "renamed",
    "deleted",
    "restricted",
    "access_changed",
    "column_created",
    "column_updated",
    "column_moved",
    "column_deleted",
    "label_changed",
  ]),
  boardId: Schema.NullOr(BoardId),
  columnId: Schema.NullOr(ColumnId),
})

/**
 * Task lifecycle. `position`, `columnId`, `title` and `priority` are present only when they
 * changed, so clients patch their local card instead of refetching the board.
 */
export const TaskChanged = Schema.TaggedStruct("TaskChanged", {
  ...base,
  kind: Schema.Literals(["created", "updated", "moved", "deleted", "restored"]),
  boardId: Schema.NullOr(BoardId),
  columnId: Schema.optionalKey(Schema.NullOr(ColumnId)),
  columnCategory: Schema.optionalKey(ColumnCategory),
  position: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  priority: Schema.optionalKey(Priority),
  key: Schema.String,
})

export const CommentChanged = Schema.TaggedStruct("CommentChanged", {
  ...base,
  kind: Schema.Literals(["created", "updated", "deleted"]),
  taskId: TaskId,
})

/**
 * Doc tree, content metadata, versions and doc comments. `docId` is the doc; `entityId` is the doc
 * or the comment for comment kinds. Space docs have a `null` project.
 */
export const DocChanged = Schema.TaggedStruct("DocChanged", {
  ...base,
  kind: Schema.Literals([
    "created",
    "renamed",
    "icon_changed",
    "moved",
    "deleted",
    "restored",
    "restricted",
    "review_changed",
    "verified",
    "access_changed",
    "edited",
    /** A save whose unsafe content was dropped; live sessions take the stored state. */
    "repaired",
    "version_created",
    "version_restored",
    "comment_created",
    "comment_updated",
    "comment_deleted",
  ]),
  docId: DocId,
})

/** Sent to the recipient's `inbox` scope only. */
export const NotificationChanged = Schema.TaggedStruct("NotificationChanged", {
  ...base,
  userId: UserId,
  notificationId: NotificationId,
  kind: Schema.Literals(["created", "updated", "read", "archived"]),
})

/**
 * Channel lifecycle, membership and settings. `entityId` is the channel id; `channelId` routes the
 * event to `channel:<id>` subscribers.
 */
export const ChannelChanged = Schema.TaggedStruct("ChannelChanged", {
  ...base,
  channelId: ChannelId,
  kind: Schema.Literals([
    "created",
    "updated",
    "archived",
    "unarchived",
    "membership_changed",
    "access_changed",
  ]),
})

/**
 * Messages, threads, reactions and pins. `entityId` is the message id; `channelId` routes the event
 * to `channel:<id>` subscribers, and the server checks the viewer can read the channel.
 */
export const MessageChanged = Schema.TaggedStruct("MessageChanged", {
  ...base,
  channelId: ChannelId,
  messageId: MessageId,
  kind: Schema.Literals([
    "created",
    "edited",
    "deleted",
    "pinned",
    "unpinned",
    "reaction_changed",
    "thread_reply",
    "purged",
  ]),
})

/** Per-user channel state: read position, mute and thread follows. Sent to `inbox` only. */
export const ReadStateChanged = Schema.TaggedStruct("ReadStateChanged", {
  ...base,
  userId: UserId,
  channelId: ChannelId,
  kind: Schema.Literals(["read", "muted_changed", "thread_followed", "thread_unfollowed"]),
})

/**
 * Events and occurrences. `entityId` is the event id, `calendarId` routes the event to
 * `entity:<calendarId>` subscribers, and the server checks the viewer can read the calendar.
 */
export const EventChanged = Schema.TaggedStruct("EventChanged", {
  ...base,
  calendarId: CalendarId,
  eventId: EventId,
  kind: Schema.Literals(["created", "updated", "deleted", "rsvp_changed"]),
})

export const CalendarChanged = Schema.TaggedStruct("CalendarChanged", {
  ...base,
  calendarId: CalendarId,
  kind: Schema.Literals(["created", "updated", "deleted"]),
})

export const DomainEvent = Schema.Union([
  MembersChanged,
  InvitesChanged,
  TeamsChanged,
  WorkspaceUpdated,
  ProfileUpdated,
  ProjectChanged,
  BoardChanged,
  TaskChanged,
  CommentChanged,
  NotificationChanged,
  DocChanged,
  ChannelChanged,
  MessageChanged,
  ReadStateChanged,
  EventChanged,
  CalendarChanged,
])
export type DomainEvent = typeof DomainEvent.Type

/**
 * Subscription scopes: `workspace` (members, teams, settings), `project:<KEY>`, `channel:<id>`,
 * `entity:<id>` and `inbox` (the subscriber's notifications).
 */
export const Scope = Schema.String.check(
  Schema.isPattern(
    /^(workspace|inbox|project:[A-Z]{2,6}|channel:[0-9a-f-]{36}|entity:[0-9a-f-]{36})$/,
  ),
)

export const RealtimeEvent = Schema.TaggedStruct("Event", {
  /** Per-connection sequence; the client sends the last one back when it reconnects. */
  seq: Schema.Int,
  event: DomainEvent,
})
/** The replay buffer no longer covers the gap: refetch everything in the subscribed scopes. */
export const RealtimeResync = Schema.TaggedStruct("Resync", { reason: Schema.String })
export const RealtimeMessage = Schema.Union([RealtimeEvent, RealtimeResync])
export type RealtimeMessage = typeof RealtimeMessage.Type

export const SubscribeInput = Schema.Struct({
  scopes: Schema.Array(Scope),
  /** Connection id and last sequence from a previous connection, to replay missed events. */
  resume: Schema.optionalKey(Schema.Struct({ connectionId: Schema.String, lastSeq: Schema.Int })),
})

export type SubscribeInput = typeof SubscribeInput.Type

export const Hello = Schema.TaggedStruct("Hello", { connectionId: Schema.String })
export type Hello = typeof Hello.Type

// --- Presence --------------------------------------------------------------

/**
 * Who is looking at a scope right now. Held in memory only, never stored or audited. Updates are
 * throttled to one per second per user; `presence.update` reports whether it was accepted.
 */
export const PresenceViewer = Schema.Struct({
  userId: UserId,
  name: Schema.String,
  /** Task, board or document the viewer currently has open, if any. */
  focusEntityId: Schema.NullOr(EntityId),
  /** True while this viewer is typing in the scope; clears ~5 s after the last refresh. */
  typing: Schema.Boolean,
})
export type PresenceViewer = typeof PresenceViewer.Type

export const PresenceState = Schema.TaggedStruct("Presence", {
  scope: Scope,
  viewers: Schema.Array(PresenceViewer),
})
export type PresenceState = typeof PresenceState.Type

export const PresenceJoinInput = Schema.Struct({ scope: Scope })
export const PresenceUpdateInput = Schema.Struct({
  scope: Scope,
  focusEntityId: Schema.NullOr(EntityId),
  /** `true` starts or refreshes typing, `false` stops it at once. Never stored. */
  typing: Schema.optionalKey(Schema.Boolean),
})
export const PresenceUpdateResult = Schema.Struct({ accepted: Schema.Boolean })

export class RealtimeRpcs extends RpcGroup.make(
  Rpc.make("realtime.subscribe", {
    payload: SubscribeInput,
    success: Schema.Union([Hello, RealtimeEvent, RealtimeResync]),
    error: Unauthorized,
    stream: true,
  }),
  Rpc.make("presence.join", {
    payload: PresenceJoinInput,
    success: PresenceState,
    error: Unauthorized,
    stream: true,
  }),
  Rpc.make("presence.update", {
    payload: PresenceUpdateInput,
    success: PresenceUpdateResult,
    error: Unauthorized,
  }),
).middleware(RpcAuthentication) {}
