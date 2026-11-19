import { Schema } from "effect"
import { EntityId, NotificationId, UserId } from "../ids.ts"

export const NotificationKind = Schema.Literals([
  "task_due_soon",
  "task_overdue",
  "task_assigned",
  "mention",
  "doc_review_due",
  "direct_message",
  "thread_reply",
  "task_unassigned",
  "task_changed",
  "comment_added",
  "invite_accepted",
  "event_invited",
  "event_changed",
  "event_reminder",
])
export type NotificationKind = typeof NotificationKind.Type

export const NotificationChannel = Schema.Literals(["in_app", "push", "email"])
export type NotificationChannel = typeof NotificationChannel.Type

export const Notification = Schema.Struct({
  id: NotificationId,
  kind: NotificationKind,
  entityId: EntityId,
  actorId: Schema.NullOr(UserId),
  payload: Schema.Record(Schema.String, Schema.Unknown),
  groupKey: Schema.String,
  readAt: Schema.NullOr(Schema.Date),
  archivedAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
})
export type Notification = typeof Notification.Type

export const NotificationPref = Schema.Struct({
  kind: Schema.String,
  channel: NotificationChannel,
  enabled: Schema.Boolean,
})
export type NotificationPref = typeof NotificationPref.Type

/** The caller's delivery settings. `prefs` lists explicit overrides; absent pairs use the defaults. */
export const NotificationSettings = Schema.Struct({
  prefs: Schema.Array(NotificationPref),
  quietStart: Schema.NullOr(Schema.String),
  quietEnd: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  pushPublicKey: Schema.NullOr(Schema.String),
  pushSubscribed: Schema.Boolean,
  emailEnabled: Schema.Boolean,
})
export type NotificationSettings = typeof NotificationSettings.Type

export const UpdateNotificationPrefInput = NotificationPref
export type UpdateNotificationPrefInput = typeof UpdateNotificationPrefInput.Type

const QuietTime = Schema.NullOr(
  Schema.String.check(Schema.isPattern(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)),
)

export const UpdateQuietHoursInput = Schema.Struct({
  quietStart: QuietTime,
  quietEnd: QuietTime,
})
export type UpdateQuietHoursInput = typeof UpdateQuietHoursInput.Type

export const PushSubscriptionInput = Schema.Struct({
  endpoint: Schema.String.check(Schema.isMaxLength(2048)),
  p256dh: Schema.String.check(Schema.isMaxLength(256)),
  auth: Schema.String.check(Schema.isMaxLength(256)),
})
export type PushSubscriptionInput = typeof PushSubscriptionInput.Type

export const RemovePushSubscriptionInput = Schema.Struct({
  endpoint: Schema.String.check(Schema.isMaxLength(2048)),
})
export type RemovePushSubscriptionInput = typeof RemovePushSubscriptionInput.Type
