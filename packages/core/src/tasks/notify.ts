/**
 * Notifications and watchers. A notification is only written when the recipient can still see the
 * entity, so a later permission change never leaks through an old reminder.
 */
import { notifications, watchers, type notificationKinds } from "@audit/db/schema"
import type { EntityId, NotificationId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { emit } from "../trail.ts"

export type NotificationKind = (typeof notificationKinds)[number]

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

/** Writes a notification if the recipient can see `entityId`. Returns whether it was written. */
export const notify = (input: NotifyInput) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const role = yield* authz.roleOn(input.userId, input.entityId)
    if (role === null) return false
    const [row] = yield* db
      .insert(notifications)
      .values({
        userId: input.userId,
        kind: input.kind,
        entityId: input.entityId,
        actorId: input.actorId,
        payload: input.payload,
        groupKey: input.groupKey,
      })
      .returning({ id: notifications.id })
      .pipe(Effect.orDie)
    yield* emit({
      _tag: "NotificationChanged",
      kind: "created",
      entityId: input.entityId,
      projectId: input.projectId,
      actorId: input.actorId,
      version: 0,
      userId: input.userId,
      notificationId: row!.id as NotificationId,
    })
    return true
  })

/** Follows an entity's changes. Idempotent. */
export const watch = (entityId: EntityId, userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.insert(watchers).values({ entityId, userId }).onConflictDoNothing().pipe(Effect.orDie)
  })

const collectMentions = (node: unknown, found: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const child of node) collectMentions(child, found)
    return
  }
  if (typeof node !== "object" || node === null) return
  const record = node as Record<string, unknown>
  if (record.type === "mention") {
    const attrs = record.attrs as Record<string, unknown> | undefined
    if (typeof attrs?.id === "string") found.add(attrs.id)
  }
  for (const value of Object.values(record)) collectMentions(value, found)
}

/** User ids mentioned in a Tiptap document (`{type: "mention", attrs: {id}}` nodes). */
export const mentionedUserIds = (body: unknown): string[] => {
  const found = new Set<string>()
  collectMentions(body, found)
  return [...found]
}

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
