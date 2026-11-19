import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { CommandError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { NotificationId } from "../ids.ts"
import {
  Notification,
  NotificationSettings,
  PushSubscriptionInput,
  RemovePushSubscriptionInput,
  UpdateNotificationPrefInput,
  UpdateQuietHoursInput,
} from "./schema.ts"

/** The caller's inbox and delivery settings. Every route is scoped to the caller. */
export const NotificationsApi = HttpApiGroup.make("notifications")
  .add(
    HttpApiEndpoint.get("list", "/api/notifications", {
      query: { archived: Schema.optional(Schema.Literals(["true", "false"])) },
      success: Schema.Array(Notification),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("readAll", "/api/notifications/read-all", {
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("read", "/api/notifications/:notificationId/read", {
      params: { notificationId: NotificationId },
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unread", "/api/notifications/:notificationId/unread", {
      params: { notificationId: NotificationId },
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("archive", "/api/notifications/:notificationId/archive", {
      params: { notificationId: NotificationId },
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unarchive", "/api/notifications/:notificationId/unarchive", {
      params: { notificationId: NotificationId },
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("settings", "/api/notifications/settings", {
      success: NotificationSettings,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.put("updatePref", "/api/notifications/prefs", {
      payload: UpdateNotificationPrefInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.put("updateQuietHours", "/api/notifications/quiet-hours", {
      payload: UpdateQuietHoursInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("subscribePush", "/api/notifications/push", {
      payload: PushSubscriptionInput,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("unsubscribePush", "/api/notifications/push/remove", {
      payload: RemovePushSubscriptionInput,
      error: CommandError,
    }),
  )
  .middleware(Authentication)
