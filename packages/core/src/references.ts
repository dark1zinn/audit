/**
 * Cross-references: mentions and links become rows in `references`, diffed in the same transaction
 * as the change that made them. Also cross-entity reads: resolving mention and link targets, and
 * backlinks into an entity. Invisible entities are masked (`restricted`, untitled); soft-deleted
 * ones are `deleted` to callers who could see them before deletion, `restricted` to the rest.
 */
import { entities, messages, projects, references, tasks } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import type { BacklinkGroup, Backlink, EntityRef } from "@audit/domain/docs/schema"
import type { ReferenceKind } from "@audit/domain/entity"
import type { EntityId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import { visibleTo } from "./access.ts"
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

    const authz = yield* Authz
    const visible = yield* authz.visible(sql`${entities.id}`)
    const removable = [...current.keys()].filter((id) => !wanted.has(id))
    const removed =
      removable.length === 0
        ? []
        : yield* db
            .select({ id: entities.id })
            .from(entities)
            .where(and(inArray(entities.id, removable), or(visible, isNotNull(entities.deletedAt))))
            .pipe(Effect.orDie)
    if (removed.length > 0) {
      yield* db.delete(references).where(
        and(
          eq(references.sourceId, sourceId),
          eq(references.kind, kind),
          inArray(
            references.targetId,
            removed.map((row) => row.id),
          ),
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
            .where(and(inArray(entities.id, candidates), visible))
            .pipe(Effect.orDie)
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
    // A soft-deleted entity shows as deleted (with its type, never its title) only to callers who
    // could see it before it was deleted; to everyone else it is indistinguishable from restricted.
    const deletedIds = rows.filter((row) => row.deletedAt !== null).map((row) => row.id)
    const userId = actorUserId(yield* CurrentActor)
    const formerlySeen =
      deletedIds.length === 0
        ? []
        : yield* db
            .select({ id: entities.id })
            .from(entities)
            .where(
              and(
                inArray(entities.id, deletedIds),
                userId === null
                  ? sql`true`
                  : visibleTo(userId, sql`${entities.id}`, { includeDeleted: true }),
              ),
            )
            .pipe(Effect.orDie)
    const formerlyVisibleIds = new Set(formerlySeen.map((row) => row.id))
    const routeRows =
      visibleIds.size === 0
        ? []
        : yield* db
            .select({
              id: entities.id,
              projectKey: projects.key,
              number: tasks.number,
              channelId: messages.channelId,
            })
            .from(entities)
            .leftJoin(
              projects,
              eq(
                projects.id,
                sql`coalesce(${entities.projectId}, case when ${entities.type} = 'project' then ${entities.id} end)`,
              ),
            )
            .leftJoin(tasks, eq(tasks.id, entities.id))
            .leftJoin(messages, eq(messages.id, entities.id))
            .where(inArray(entities.id, [...visibleIds] as EntityId[]))
            .pipe(Effect.orDie)
    const routeById = new Map(routeRows.map((row) => [row.id, row]))
    for (const row of rows) {
      const id = row.id as EntityId
      if (visibleIds.has(row.id)) {
        const route = routeById.get(row.id)
        const key =
          route?.projectKey != null && route.number != null
            ? `${route.projectKey}-${route.number}`
            : undefined
        out[id] = {
          id,
          type: row.type,
          title: row.title,
          ...(key === undefined ? {} : { key }),
          ...(route?.projectKey == null ? {} : { projectKey: route.projectKey }),
          ...(route?.number == null ? {} : { number: route.number }),
          ...(route?.channelId == null ? {} : { channelId: route.channelId as EntityId }),
          restricted: false,
          deleted: false,
        }
      } else if (formerlyVisibleIds.has(row.id)) {
        out[id] = { id, type: row.type, restricted: false, deleted: true }
      } else {
        out[id] = { id, restricted: true, deleted: false }
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
    const [target] = yield* db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, entityId), visible))
      .pipe(Effect.orDie)
    if (target === undefined) return []
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
