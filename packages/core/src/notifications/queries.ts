/** Reads of the caller's own inbox and settings. */
import { notificationPrefs, notifications, pushSubscriptions, userProfiles } from "@audit/db/schema"
import type { EntityId, NotificationId, UserId } from "@audit/domain/ids"
import type { Notification, NotificationSettings } from "@audit/domain/notifications/schema"
import { Db } from "@audit/platform/database"
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import { visibleTo } from "../access.ts"
import { currentUser } from "../current-user.ts"
import { Mailer } from "./mail.ts"
import { PushTransport } from "./push.ts"

/** Newest first; `archived` selects the archive instead of the open inbox. */
export const myNotifications = (archived: boolean) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser("notification.read")
    const rows = yield* db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          archived ? isNotNull(notifications.archivedAt) : isNull(notifications.archivedAt),
          visibleTo(userId, sql`${notifications.entityId}`),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(100)
      .pipe(Effect.orDie)
    return rows.map((row): Notification => ({
      id: row.id as NotificationId,
      kind: row.kind,
      entityId: row.entityId as EntityId,
      actorId: row.actorId as UserId | null,
      payload: row.payload,
      groupKey: row.groupKey,
      readAt: row.readAt,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
    }))
  })

/** Preferences, quiet hours and push/email availability for the caller. */
export const notificationSettings = () =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser("notification.settings")
    const push = yield* PushTransport
    const mailer = yield* Mailer
    const prefs = yield* db
      .select({
        kind: notificationPrefs.kind,
        channel: notificationPrefs.channel,
        enabled: notificationPrefs.enabled,
      })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId))
      .pipe(Effect.orDie)
    const [profile] = yield* db
      .select({
        quietStart: userProfiles.quietStart,
        quietEnd: userProfiles.quietEnd,
        timezone: userProfiles.timezone,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .pipe(Effect.orDie)
    const subscriptions = yield* db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .pipe(Effect.orDie)
    const settings: NotificationSettings = {
      prefs,
      quietStart: profile?.quietStart ?? null,
      quietEnd: profile?.quietEnd ?? null,
      timezone: profile?.timezone ?? "UTC",
      pushPublicKey: yield* push.publicKey,
      pushSubscribed: subscriptions.length > 0,
      emailEnabled: mailer.enabled,
    }
    return settings
  })
