/**
 * Cross-references: mentions and links become rows in `references`, diffed in the same transaction
 * as the change that made them. Also cross-entity reads: resolving mention and link targets, and
 * backlinks into an entity. Invisible entities are masked (`restricted`, untitled); soft-deleted
 * ones are `deleted`.
 */
import { entities, references } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import type { BacklinkGroup, Backlink, EntityRef } from "@audit/domain/docs/schema"
import type { ReferenceKind } from "@audit/domain/entity"
import type { EntityId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "./authz.ts"

export interface ReferenceTarget {
  readonly targetId: EntityId
  readonly snippet?: string
}

/**
 * Makes the `kind` references from `sourceId` exactly `targets`. Unknown target IDs are ignored.
 * Returns the newly added target IDs (for mention notifications).
 */
export const syncReferences = (
  sourceId: EntityId,
  kind: ReferenceKind,
  targets: ReadonlyArray<ReferenceTarget>,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const actor = yield* CurrentActor
    const existing = yield* db
      .select({ targetId: references.targetId, snippet: references.snippet })
      .from(references)
      .where(and(eq(references.sourceId, sourceId), eq(references.kind, kind)))
    const wanted = new Map(targets.map((t) => [t.targetId as string, t.snippet ?? null]))
    const current = new Map(existing.map((r) => [r.targetId, r.snippet]))

    const removed = [...current.keys()].filter((id) => !wanted.has(id))
    if (removed.length > 0) {
      yield* db
        .delete(references)
        .where(
          and(
            eq(references.sourceId, sourceId),
            eq(references.kind, kind),
            inArray(references.targetId, removed),
          ),
        )
    }

    const candidates = [...wanted.keys()].filter((id) => !current.has(id))
    const known =
      candidates.length === 0
        ? []
        : yield* db
            .select({ id: entities.id })
            .from(entities)
            .where(inArray(entities.id, candidates))
    const added = known.map((row) => row.id as EntityId).filter((id) => id !== sourceId)
    if (added.length > 0) {
      yield* db.insert(references).values(
        added.map((targetId) => ({
          sourceId,
          targetId,
          kind,
          snippet: wanted.get(targetId) ?? null,
          createdBy: actorUserId(actor),
        })),
      )
    }

    for (const [targetId, snippet] of wanted) {
      if (current.has(targetId) && current.get(targetId) !== snippet) {
        yield* db
          .update(references)
          .set({ snippet })
          .where(
            and(
              eq(references.sourceId, sourceId),
              eq(references.targetId, targetId),
              eq(references.kind, kind),
            ),
          )
      }
    }
    return added
  }).pipe(Effect.orDie)

/** Entity refs for the given ids, keyed by id. Missing ids are left out. */
export const resolveEntities = (ids: ReadonlyArray<EntityId>) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const out: Record<string, EntityRef> = {}
    if (ids.length === 0) return out
    const rows = yield* db
      .select({
        id: entities.id,
        type: entities.type,
        title: entities.title,
        deletedAt: entities.deletedAt,
      })
      .from(entities)
      .where(inArray(entities.id, ids))
      .pipe(Effect.orDie)
    const visible = yield* authz.visible(sql`${entities.id}`)
    const seen = yield* db
      .select({ id: entities.id })
      .from(entities)
      .where(and(inArray(entities.id, ids), visible))
      .pipe(Effect.orDie)
    const visibleIds = new Set(seen.map((row) => row.id))
    for (const row of rows) {
      const id = row.id as EntityId
      if (row.deletedAt !== null) {
        out[id] = { id, type: row.type, restricted: false, deleted: true }
      } else if (!visibleIds.has(row.id)) {
        out[id] = { id, type: row.type, restricted: true, deleted: false }
      } else {
        out[id] = { id, type: row.type, title: row.title, restricted: false, deleted: false }
      }
    }
    return out
  })

/** Live sources the caller can see that reference `entityId`, grouped by source type. */
export const backlinks = (entityId: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const visible = yield* authz.visible(sql`${entities.id}`)
    const rows = yield* db
      .select({
        sourceId: references.sourceId,
        sourceType: entities.type,
        sourceTitle: entities.title,
        kind: references.kind,
        snippet: references.snippet,
        updatedAt: entities.updatedAt,
      })
      .from(references)
      .innerJoin(entities, eq(entities.id, references.sourceId))
      .where(and(eq(references.targetId, entityId), isNull(entities.deletedAt), visible))
      .orderBy(desc(entities.updatedAt))
      .pipe(Effect.orDie)
    const groups = new Map<string, Backlink[]>()
    for (const row of rows) {
      const item: Backlink = {
        sourceId: row.sourceId as EntityId,
        sourceType: row.sourceType,
        sourceTitle: row.sourceTitle,
        kind: row.kind,
        snippet: row.snippet ?? "",
        updatedAt: row.updatedAt,
      }
      groups.set(row.sourceType, [...(groups.get(row.sourceType) ?? []), item])
    }
    return [...groups].map(([type, items]): BacklinkGroup => ({ type, items }))
  })
