/**
 * Message retention: when the workspace sets `messageRetentionDays`, the daily job removes older
 * messages except pinned ones. A message that still has replies becomes a tombstone so its thread
 * keeps an anchor; any other message is removed with its reactions, saves, pins and references.
 * Each channel touched gets one `message.purged` trail entry carrying the count.
 */
import {
  entities,
  messages,
  pins,
  references,
  reactions,
  savedMessages,
  workspace,
} from "@audit/db/schema"
import { CurrentActor } from "@audit/domain/actor"
import { Forbidden } from "@audit/domain/errors"
import type { EntityId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { eq, inArray, lt, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { softDeleteEntity, touchEntity } from "../entities.ts"
import { record } from "../trail.ts"

const DAY_MS = 24 * 60 * 60 * 1000
const EMPTY_BODY = { type: "doc", content: [] }

export const purgeMessages = Command.make("chat.retention", {
  input: Schema.Struct({}),
  output: Schema.Struct({ purged: Schema.Int }),
  authorize: () =>
    Effect.gen(function* () {
      const actor = yield* CurrentActor
      if (actor._tag !== "system") {
        return yield* new Forbidden({
          action: "chat.retention",
          message: "Only background jobs can do this",
        })
      }
    }),
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db
        .select({ settings: workspace.settings })
        .from(workspace)
        .pipe(Effect.orDie)
      const settings = row?.settings as { messageRetentionDays?: number | null } | undefined
      const days = settings?.messageRetentionDays ?? null
      if (days === null) return { purged: 0 }

      const cutoff = new Date(Date.now() - days * DAY_MS)
      const old = yield* db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          threadRootId: messages.threadRootId,
        })
        .from(messages)
        .innerJoin(entities, eq(entities.id, messages.id))
        .where(lt(entities.createdAt, cutoff))
        .pipe(Effect.orDie)
      if (old.length === 0) return { purged: 0 }

      const pinnedRows = yield* db
        .select({ messageId: pins.messageId })
        .from(pins)
        .where(
          inArray(
            pins.messageId,
            old.map((m) => m.id),
          ),
        )
        .pipe(Effect.orDie)
      const pinned = new Set(pinnedRows.map((p) => p.messageId))
      // Replies first, so a root is only removed once its own replies are gone.
      const candidates = old
        .filter((m) => !pinned.has(m.id))
        .toSorted((a, b) => Number(b.threadRootId !== null) - Number(a.threadRootId !== null))

      const now = new Date()
      const perChannel = new Map<string, number>()
      for (const message of candidates) {
        const id = message.id as EntityId
        const replies = yield* db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.threadRootId, message.id))
          .limit(1)
          .pipe(Effect.orDie)
        if (replies.length > 0) {
          yield* db
            .update(messages)
            .set({ body: EMPTY_BODY, bodyText: "", deletedAt: now })
            .where(eq(messages.id, message.id))
            .pipe(Effect.orDie)
          yield* db.delete(reactions).where(eq(reactions.messageId, message.id)).pipe(Effect.orDie)
          yield* db
            .delete(savedMessages)
            .where(eq(savedMessages.messageId, message.id))
            .pipe(Effect.orDie)
          yield* db.delete(references).where(eq(references.sourceId, id)).pipe(Effect.orDie)
          yield* touchEntity(id)
        } else {
          yield* db
            .delete(references)
            .where(or(eq(references.sourceId, id), eq(references.targetId, id)))
            .pipe(Effect.orDie)
          if (message.threadRootId !== null) {
            yield* db
              .update(messages)
              .set({ replyCount: sql`greatest(${messages.replyCount} - 1, 0)` })
              .where(eq(messages.id, message.threadRootId))
              .pipe(Effect.orDie)
          }
          yield* db.delete(messages).where(eq(messages.id, message.id)).pipe(Effect.orDie)
          yield* softDeleteEntity(id)
        }
        perChannel.set(message.channelId, (perChannel.get(message.channelId) ?? 0) + 1)
      }

      for (const [channelId, count] of perChannel) {
        yield* record({
          action: "message.purged",
          entityId: channelId as EntityId,
          entityType: "channel",
          details: { count, retentionDays: days },
        })
      }
      return { purged: candidates.length }
    }),
})

export const purgeMessagesJob = defineJob("chat.retention", Schema.Struct({}))
