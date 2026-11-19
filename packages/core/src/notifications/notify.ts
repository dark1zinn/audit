/**
 * Notifications and watchers. A notification is only written when the recipient can still see the
 * entity, so a later permission change never leaks through an old reminder. Repeated changes to the
 * same item within a burst window fold into the open notification instead of adding new ones.
 */
import {
  notificationChannels,
  notificationKinds,
  notificationPrefs,
  notifications,
  userProfiles,
  watchers,
} from "@audit/db/schema"
import type { EntityId, NotificationId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { defineJob, Jobs } from "@audit/platform/jobs"
import { and, desc, eq, gte, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import { emit } from "../trail.ts"

export type NotificationKind = (typeof notificationKinds)[number]
export type NotificationChannel = (typeof notificationChannels)[number]

/** Changes to the same item (same user and group key) within this window fold into one notification. */
export const BURST_WINDOW_MS = 5 * 60 * 1000

/** Out-of-app delivery. Enqueued per notification; deferred to the end of quiet hours. */
export const deliverJob = defineJob(
  "notification.deliver",
  Schema.Struct({
    notificationId: Schema.String,
    channel: Schema.Literals(["push", "email"]),
  }),
)

export interface NotifyInput {
  readonly userId: UserId
  readonly kind: NotificationKind
  readonly entityId: EntityId
  readonly projectId: ProjectId | null
  readonly actorId: UserId | null
  readonly payload: Record<string, unknown>
  /** Notifications with the same group key are folded together in the inbox. */
  readonly groupKey: string
}

/** Whether a user receives `kind` on `channel`. No row means the default: on. */
export const channelEnabled = (
  userId: UserId,
  kind: NotificationKind,
  channel: NotificationChannel,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ enabled: notificationPrefs.enabled })
      .from(notificationPrefs)
      .where(
        and(
          eq(notificationPrefs.userId, userId),
          eq(notificationPrefs.kind, kind),
          eq(notificationPrefs.channel, channel),
        ),
      )
      .limit(1)
      .pipe(Effect.orDie)
    return row?.enabled ?? true
  })

const minutesOfDay = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(":").map(Number)
  return hours! * 60 + minutes!
}

const localMinutes = (instant: Date, timezone: string): number => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)
  const hours = Number(parts.find((part) => part.type === "hour")?.value)
  const minutes = Number(parts.find((part) => part.type === "minute")?.value)
  return hours * 60 + minutes
}

/**
 * The instant quiet hours end when `instant` falls inside them (in the user's timezone), else null.
 * Quiet hours may wrap midnight.
 */
export const quietHoursEnd = (
  instant: Date,
  quiet: {
    readonly timezone: string
    readonly quietStart: string | null
    readonly quietEnd: string | null
  },
): Date | null => {
  if (quiet.quietStart === null || quiet.quietEnd === null) return null
  const start = minutesOfDay(quiet.quietStart)
  const end = minutesOfDay(quiet.quietEnd)
  if (start === end) return null
  const now = localMinutes(instant, quiet.timezone)
  const inQuiet = start < end ? now >= start && now < end : now >= start || now < end
  if (!inQuiet) return null
  const waitMinutes = (end - now + 1440) % 1440
  return new Date(instant.getTime() + waitMinutes * 60 * 1000)
}

const quietHoursOf = (userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [profile] = yield* db
      .select({
        timezone: userProfiles.timezone,
        quietStart: userProfiles.quietStart,
        quietEnd: userProfiles.quietEnd,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1)
      .pipe(Effect.orDie)
    return profile ?? { timezone: "UTC", quietStart: null, quietEnd: null }
  })

/** Writes a notification if the recipient can see `entityId`. Returns whether it was written or folded. */
export const notify = (input: NotifyInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const jobs = yield* Jobs
    const role = yield* authz.roleOn(input.userId, input.entityId)
    if (role === null) return false
    if (!(yield* channelEnabled(input.userId, input.kind, "in_app"))) return false

    const now = new Date()
    const [open] = yield* db
      .select({ id: notifications.id, payload: notifications.payload })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, input.userId),
          eq(notifications.groupKey, input.groupKey),
          isNull(notifications.archivedAt),
          gte(notifications.createdAt, new Date(now.getTime() - BURST_WINDOW_MS)),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1)
      .pipe(Effect.orDie)

    if (open !== undefined) {
      const count = typeof open.payload.count === "number" ? open.payload.count : 1
      yield* db
        .update(notifications)
        .set({
          payload: { ...input.payload, count: count + 1 },
          actorId: input.actorId,
          readAt: null,
          createdAt: now,
        })
        .where(eq(notifications.id, open.id))
        .pipe(Effect.orDie)
      yield* emit({
        _tag: "NotificationChanged",
        kind: "updated",
        entityId: input.entityId,
        projectId: input.projectId,
        actorId: input.actorId,
        version: 0,
        userId: input.userId,
        notificationId: open.id as NotificationId,
      })
      return true
    }

    const [row] = yield* db
      .insert(notifications)
      .values({
        userId: input.userId,
        kind: input.kind,
        entityId: input.entityId,
        actorId: input.actorId,
        payload: { ...input.payload, count: 1 },
        groupKey: input.groupKey,
      })
      .returning({ id: notifications.id })
      .pipe(Effect.orDie)
    if (row === undefined) return false
    yield* emit({
      _tag: "NotificationChanged",
      kind: "created",
      entityId: input.entityId,
      projectId: input.projectId,
      actorId: input.actorId,
      version: 0,
      userId: input.userId,
      notificationId: row.id as NotificationId,
    })

    const quiet = yield* quietHoursOf(input.userId)
    const deferUntil = quietHoursEnd(now, quiet)
    for (const channel of ["push", "email"] as const) {
      if (!(yield* channelEnabled(input.userId, input.kind, channel))) continue
      yield* jobs.enqueue(
        deliverJob,
        { notificationId: row.id, channel },
        deferUntil === null ? undefined : { startAfter: deferUntil },
      )
    }
    return true
  })

/** Follows an entity's changes. Idempotent. */
export const watch = (entityId: EntityId, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.insert(watchers).values({ entityId, userId }).onConflictDoNothing().pipe(Effect.orDie)
  })

/** Notifies everyone watching an entity except the actor, with the same payload. */
export const notifyWatchers = (input: Omit<NotifyInput, "userId">) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ userId: watchers.userId })
      .from(watchers)
      .where(eq(watchers.entityId, input.entityId))
      .pipe(Effect.orDie)
    for (const row of rows) {
      if (row.userId === input.actorId) continue
      yield* notify({ ...input, userId: row.userId as UserId })
    }
  })

const collectText = (node: unknown, parts: string[]): void => {
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, parts)
    return
  }
  if (typeof node !== "object" || node === null) return
  const record = node as Record<string, unknown>
  if (typeof record.text === "string") parts.push(record.text)
  for (const value of Object.values(record)) collectText(value, parts)
}

/** Plain text of a Tiptap document, used for search and previews. */
export const plainText = (body: unknown): string => {
  const parts: string[] = []
  collectText(body, parts)
  return parts.join(" ").replace(/\s+/g, " ").trim()
}
