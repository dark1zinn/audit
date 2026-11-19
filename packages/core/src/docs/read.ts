/**
 * Shared doc reads for commands and queries: the joined `docs` + `entities` row, the public node
 * shape, sibling ordering and subtree ids.
 */
import { docs, entities } from "@audit/db/schema"
import type { DocNode } from "@audit/domain/docs/schema"
import { NotFound } from "@audit/domain/errors"
import type { DocId, EntityId, ProjectId, UserId } from "@audit/domain/ids"
import { keyBetween } from "@audit/domain/ordering"
import { Db } from "@audit/platform/database"
import { type SQL, and, asc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

/** A live doc with its entity fields, as stored. */
export interface DocRow {
  readonly id: DocId
  readonly parentId: EntityId
  readonly parentDocId: DocId | null
  readonly projectId: ProjectId | null
  readonly title: string
  readonly icon: string | null
  readonly position: string
  readonly restricted: boolean
  readonly reviewEveryDays: number | null
  readonly ownerUserId: UserId | null
  readonly verifiedAt: Date | null
  readonly lastEditedAt: Date | null
  readonly updatedAt: Date
  readonly version: number
  readonly createdAt: Date
}

/** Select of the joined doc row, filtered to live docs and ordered by position. */
export const selectDocs = (where: SQL | undefined) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({
        id: docs.id,
        parentId: entities.parentId,
        parentDocId: docs.parentDocId,
        projectId: docs.projectId,
        title: entities.title,
        icon: docs.icon,
        position: docs.position,
        restricted: entities.restricted,
        reviewEveryDays: docs.reviewEveryDays,
        ownerUserId: docs.ownerUserId,
        verifiedAt: docs.verifiedAt,
        lastEditedAt: docs.lastEditedAt,
        updatedAt: entities.updatedAt,
        version: entities.version,
        createdAt: entities.createdAt,
      })
      .from(docs)
      .innerJoin(entities, eq(entities.id, docs.id))
      .where(and(isNull(entities.deletedAt), where))
      .orderBy(asc(docs.position))
      .pipe(Effect.orDie)
    return rows.map((row): DocRow => ({
      id: row.id as DocId,
      parentId: row.parentId as EntityId,
      parentDocId: row.parentDocId as DocId | null,
      projectId: row.projectId as ProjectId | null,
      title: row.title,
      icon: row.icon,
      position: row.position,
      restricted: row.restricted,
      reviewEveryDays: row.reviewEveryDays,
      ownerUserId: row.ownerUserId as UserId | null,
      verifiedAt: row.verifiedAt,
      lastEditedAt: row.lastEditedAt,
      updatedAt: row.updatedAt,
      version: row.version,
      createdAt: row.createdAt,
    }))
  })

/** Loads one live doc or fails with NotFound. */
export const loadDoc = (docId: DocId) =>
  Effect.gen(function* () {
    const [row] = yield* selectDocs(eq(docs.id, docId))
    if (row === undefined) return yield* new NotFound({ entity: "doc", id: docId })
    return row
  })

/** The public node shape of a doc row. */
export const toNode = (row: DocRow): DocNode => ({
  id: row.id,
  parentId: row.parentId,
  projectId: row.projectId,
  title: row.title,
  icon: row.icon,
  position: row.position,
  restricted: row.restricted,
  reviewEveryDays: row.reviewEveryDays,
  ownerUserId: row.ownerUserId,
  verifiedAt: row.verifiedAt,
  lastEditedAt: row.lastEditedAt,
  updatedAt: row.updatedAt,
  version: row.version,
})

/**
 * Fractional position for a doc placed after `afterId` under `parentId`. `afterId` omitted puts it
 * last, `null` first.
 */
export const positionAmong = (parentId: EntityId, afterId: DocId | null | undefined) =>
  Effect.gen(function* () {
    const siblings = yield* selectDocs(eq(entities.parentId, parentId))
    const positions = siblings.map((s) => s.position)
    if (afterId === undefined) return keyBetween(positions.at(-1) ?? null, null)
    if (afterId === null) return keyBetween(null, positions[0] ?? null)
    const index = siblings.findIndex((s) => s.id === afterId)
    if (index === -1) return keyBetween(positions.at(-1) ?? null, null)
    return keyBetween(siblings[index]!.position, siblings[index + 1]?.position ?? null)
  })

/** The doc and every doc below it, for subtree updates and deletes. */
export const subtreeIds = (docId: DocId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ id: docs.id })
      .from(docs)
      .where(
        sql`${docs.id} in (
          with recursive subtree as (
            select id from docs where id = ${docId}
            union all
            select d.id from docs d join subtree s on d.parent_doc_id = s.id
          )
          select id from subtree
        )`,
      )
      .pipe(Effect.orDie)
    return rows.map((row) => row.id as DocId)
  })
