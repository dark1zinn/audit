/**
 * Branded UUIDv7 identifiers.
 *
 * Every referenceable thing has a row in `entities`, and its type table shares that row's ID, so
 * entity IDs carry two brands: `EntityId` plus their own type. A `TaskId` is accepted where an
 * `EntityId` is expected, but a `DocId` passed where a `TaskId` is expected fails to compile.
 */
import { Schema } from "effect"

export const Uuid = Schema.String.check(Schema.isUUID())

export const EntityId = Uuid.pipe(Schema.brand("EntityId"))
export type EntityId = typeof EntityId.Type

export const UserId = EntityId.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type
export const TeamId = EntityId.pipe(Schema.brand("TeamId"))
export type TeamId = typeof TeamId.Type
export const ProjectId = EntityId.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type
export const BoardId = EntityId.pipe(Schema.brand("BoardId"))
export type BoardId = typeof BoardId.Type
export const TaskId = EntityId.pipe(Schema.brand("TaskId"))
export type TaskId = typeof TaskId.Type
export const DocId = EntityId.pipe(Schema.brand("DocId"))
export type DocId = typeof DocId.Type
export const CommentId = EntityId.pipe(Schema.brand("CommentId"))
export type CommentId = typeof CommentId.Type
export const ChannelId = EntityId.pipe(Schema.brand("ChannelId"))
export type ChannelId = typeof ChannelId.Type
export const MessageId = EntityId.pipe(Schema.brand("MessageId"))
export type MessageId = typeof MessageId.Type
export const CalendarId = EntityId.pipe(Schema.brand("CalendarId"))
export type CalendarId = typeof CalendarId.Type
export const EventId = EntityId.pipe(Schema.brand("EventId"))
export type EventId = typeof EventId.Type
export const FileId = EntityId.pipe(Schema.brand("FileId"))
export type FileId = typeof FileId.Type

export const ColumnId = Uuid.pipe(Schema.brand("ColumnId"))
export type ColumnId = typeof ColumnId.Type
export const LabelId = Uuid.pipe(Schema.brand("LabelId"))
export type LabelId = typeof LabelId.Type
export const InviteId = Uuid.pipe(Schema.brand("InviteId"))
export type InviteId = typeof InviteId.Type
export const NotificationId = Uuid.pipe(Schema.brand("NotificationId"))
export type NotificationId = typeof NotificationId.Type
export const TrailEventId = Uuid.pipe(Schema.brand("TrailEventId"))
export type TrailEventId = typeof TrailEventId.Type
export const DocVersionId = Uuid.pipe(Schema.brand("DocVersionId"))
export type DocVersionId = typeof DocVersionId.Type
export const AiProviderId = Uuid.pipe(Schema.brand("AiProviderId"))
export type AiProviderId = typeof AiProviderId.Type
export const AiConversationId = Uuid.pipe(Schema.brand("AiConversationId"))
export type AiConversationId = typeof AiConversationId.Type
export const AiMessageId = Uuid.pipe(Schema.brand("AiMessageId"))
export type AiMessageId = typeof AiMessageId.Type
export const AiProposalId = Uuid.pipe(Schema.brand("AiProposalId"))
export type AiProposalId = typeof AiProposalId.Type
