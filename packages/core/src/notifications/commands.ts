/**
 * Inbox state and notification settings. Every command acts on the caller's own notifications or
 * settings; another user's notification id resolves to NotFound.
 */
import {
  entities,
  notificationPrefs,
  notifications,
  pushSubscriptions,
  userProfiles,
} from "@audit/db/schema"
import { Conflict, NotFound, ValidationError } from "@audit/domain/errors"
import type { EntityId, ProjectId, UserId } from "@audit/domain/ids"
import { NotificationId } from "@audit/domain/ids"
import {
  isPushEndpoint,
  NotificationKind,
  PushSubscriptionInput,
  RemovePushSubscriptionInput,
  UpdateNotificationPrefInput,
  UpdateQuietHoursInput,
} from "@audit/domain/notifications/schema"
import { Db } from "@audit/platform/database"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { emit } from "../trail.ts"
import { PushTransport } from "./push.ts"

/** The caller's notification, or NotFound (never reveals another user's row). */
const ownNotification = (notificationId: NotificationId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser("notification.update")
    const [row] = yield* db
      .select({ userId: notifications.userId, entityId: notifications.entityId })
      .from(notifications)
      .where(eq(notifications.id, notificationId))
      .pipe(Effect.orDie)
    if (!row || row.userId !== userId)
      return yield* new NotFound({ entity: "notification", id: notificationId })
    return { userId: userId as UserId, entityId: row.entityId as EntityId }
  })

/** Project of the entity a notification points at. */
const projectOf = (entityId: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ projectId: entities.projectId })
      .from(entities)
      .where(eq(entities.id, entityId))
      .pipe(Effect.orDie)
    return (row?.projectId ?? null) as ProjectId | null
  })

/** Changes one notification's state and emits the matching event to the recipient. */
const changeState = (
  notificationId: NotificationId,
  kind: "read" | "updated" | "archived",
  patch: Partial<typeof notifications.$inferInsert>,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const owner = yield* ownNotification(notificationId)
    yield* db
      .update(notifications)
      .set(patch)
      .where(eq(notifications.id, notificationId))
      .pipe(Effect.orDie)
    yield* emit({
      _tag: "NotificationChanged",
      kind,
      entityId: owner.entityId,
      projectId: yield* projectOf(owner.entityId),
      actorId: owner.userId,
      version: 0,
      userId: owner.userId,
      notificationId,
    })
  })

const NotificationIdInput = Schema.Struct({ notificationId: NotificationId })

export const markNotificationRead = Command.make("notification.read", {
  input: NotificationIdInput,
  output: Schema.Void,
  authorize: (input) => ownNotification(input.notificationId).pipe(Effect.asVoid),
  run: (input) => changeState(input.notificationId, "read", { readAt: new Date() }),
})

export const markNotificationUnread = Command.make("notification.unread", {
  input: NotificationIdInput,
  output: Schema.Void,
  authorize: (input) => ownNotification(input.notificationId).pipe(Effect.asVoid),
  run: (input) => changeState(input.notificationId, "updated", { readAt: null }),
})

export const archiveNotification = Command.make("notification.archive", {
  input: NotificationIdInput,
  output: Schema.Void,
  authorize: (input) => ownNotification(input.notificationId).pipe(Effect.asVoid),
  run: (input) => changeState(input.notificationId, "archived", { archivedAt: new Date() }),
})

export const unarchiveNotification = Command.make("notification.unarchive", {
  input: NotificationIdInput,
  output: Schema.Void,
  authorize: (input) => ownNotification(input.notificationId).pipe(Effect.asVoid),
  run: (input) => changeState(input.notificationId, "updated", { archivedAt: null }),
})

/** Marks every unread, unarchived notification of the caller as read. */
export const markAllNotificationsRead = Command.make("notification.read_all", {
  input: Schema.Struct({}),
  output: Schema.Void,
  authorize: () => currentUser("notification.read").pipe(Effect.asVoid),
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("notification.read")
      const rows = yield* db
        .select({ id: notifications.id, entityId: notifications.entityId })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            isNull(notifications.archivedAt),
          ),
        )
        .pipe(Effect.orDie)
      const readAt = new Date()
      for (const row of rows) {
        yield* db
          .update(notifications)
          .set({ readAt })
          .where(eq(notifications.id, row.id))
          .pipe(Effect.orDie)
        yield* emit({
          _tag: "NotificationChanged",
          kind: "read",
          entityId: row.entityId as EntityId,
          projectId: yield* projectOf(row.entityId as EntityId),
          actorId: userId,
          version: 0,
          userId,
          notificationId: row.id as NotificationId,
        })
      }
    }),
})

export const updateNotificationPref = Command.make("notification.pref", {
  input: UpdateNotificationPrefInput,
  output: Schema.Void,
  authorize: () => currentUser("notification.pref").pipe(Effect.asVoid),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("notification.pref")
      if (!Schema.is(NotificationKind)(input.kind))
        return yield* new ValidationError({ field: "kind", message: "unknown notification kind" })
      yield* db
        .insert(notificationPrefs)
        .values({ userId, kind: input.kind, channel: input.channel, enabled: input.enabled })
        .onConflictDoUpdate({
          target: [notificationPrefs.userId, notificationPrefs.kind, notificationPrefs.channel],
          set: { enabled: input.enabled },
        })
        .pipe(Effect.orDie)
    }),
})

export const updateQuietHours = Command.make("notification.quiet_hours", {
  input: UpdateQuietHoursInput,
  output: Schema.Void,
  authorize: () => currentUser("notification.quiet_hours").pipe(Effect.asVoid),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("notification.quiet_hours")
      if ((input.quietStart === null) !== (input.quietEnd === null))
        return yield* new ValidationError({
          field: "quietStart",
          message: "quiet hours need both start and end, or neither",
        })
      yield* db
        .update(userProfiles)
        .set({ quietStart: input.quietStart, quietEnd: input.quietEnd })
        .where(eq(userProfiles.userId, userId))
        .pipe(Effect.orDie)
    }),
})

export const subscribePush = Command.make("notification.push_subscribe", {
  input: PushSubscriptionInput,
  output: Schema.Void,
  authorize: () => currentUser("notification.push_subscribe").pipe(Effect.asVoid),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const push = yield* PushTransport
      const userId = yield* currentUser("notification.push_subscribe")
      if (!isPushEndpoint(input.endpoint))
        return yield* new ValidationError({
          field: "endpoint",
          message: "Push endpoints must be https URLs without credentials",
        })
      if (!(yield* push.allowsEndpoint(input.endpoint)))
        return yield* new ValidationError({
          field: "endpoint",
          message: "Push endpoints must resolve only to public addresses",
        })
      // Only the owner's row is updated: an endpoint another account holds yields no row back.
      const claimed = yield* db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { p256dh: input.p256dh, auth: input.auth },
          setWhere: eq(pushSubscriptions.userId, userId),
        })
        .returning({ id: pushSubscriptions.id })
        .pipe(Effect.orDie)
      if (claimed.length === 0)
        return yield* new Conflict({
          message: "This push endpoint is already registered to another account",
        })
    }),
})

export const unsubscribePush = Command.make("notification.push_unsubscribe", {
  input: RemovePushSubscriptionInput,
  output: Schema.Void,
  authorize: () => currentUser("notification.push_unsubscribe").pipe(Effect.asVoid),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("notification.push_unsubscribe")
      yield* db
        .delete(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, userId)),
        )
        .pipe(Effect.orDie)
    }),
})
