/** Lifecycle of people in the workspace: ownership handover, removal and personal data export. */
import { Schema } from "effect"
import { UserId } from "../ids.ts"
import { WorkspaceRole } from "../roles.ts"

export const TransferOwnershipInput = Schema.Struct({ userId: UserId })
export type TransferOwnershipInput = typeof TransferOwnershipInput.Type

/**
 * Everything the signed-in person can see about themselves. Shared content is limited to what they
 * can currently see; trail entries omit `diff` and `details`, which can name other people.
 */
export const PersonalExport = Schema.Struct({
  exportedAt: Schema.Date,
  profile: Schema.Struct({
    userId: UserId,
    email: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
    title: Schema.NullOr(Schema.String),
    timezone: Schema.String,
    locale: Schema.NullOr(Schema.String),
    role: WorkspaceRole,
    createdAt: Schema.Date,
    joinedAt: Schema.Date,
  }),
  notificationPrefs: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      channel: Schema.String,
      enabled: Schema.Boolean,
    }),
  ),
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      key: Schema.String,
      title: Schema.String,
      createdByMe: Schema.Boolean,
      assignedToMe: Schema.Boolean,
      createdAt: Schema.Date,
    }),
  ),
  comments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      targetId: Schema.String,
      bodyText: Schema.String,
      createdAt: Schema.Date,
      editedAt: Schema.NullOr(Schema.Date),
    }),
  ),
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      channelId: Schema.String,
      bodyText: Schema.String,
      createdAt: Schema.Date,
      editedAt: Schema.NullOr(Schema.Date),
    }),
  ),
  events: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      calendarId: Schema.String,
      title: Schema.String,
      startsAt: Schema.Date,
      endsAt: Schema.Date,
      allDay: Schema.Boolean,
      timezone: Schema.String,
      location: Schema.String,
      description: Schema.NullOr(Schema.Unknown),
      createdAt: Schema.Date,
    }),
  ),
  trail: Schema.Array(
    Schema.Struct({
      at: Schema.Date,
      action: Schema.String,
      entityType: Schema.NullOr(Schema.String),
      entityId: Schema.NullOr(Schema.String),
    }),
  ),
})
export type PersonalExport = typeof PersonalExport.Type
