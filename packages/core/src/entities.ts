/**
 * The `entities` row every referenceable thing shares: creation, title and search text, optimistic
 * concurrency, soft deletion. Feature commands call these inside their transaction.
 */
import { entities } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import type { EntityType } from "@audit/domain/entity"
import { Conflict, NotFound } from "@audit/domain/errors"
import type { EntityId, ProjectId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

export interface NewEntity<Id extends EntityId> {
  readonly type: EntityType
  /** Pre-generated id (Bun.randomUUIDv7), so the type row can share it. */
  readonly id?: Id
  readonly title: string
  readonly searchText?: string
  /** The access parent: board for a task, project for a board, channel for a message... */
  readonly parentId?: EntityId | null
  readonly projectId?: ProjectId | null
  readonly restricted?: boolean
}

export const createEntity = <Id extends EntityId>(input: NewEntity<Id>) =>
  Effect.gen(function* () {
    const db = yield* Db
    const actor = yield* CurrentActor
    const id = input.id ?? (Bun.randomUUIDv7() as Id)
    yield* db.insert(entities).values({
      id,
      type: input.type,
      title: input.title,
      searchText: input.searchText ?? "",
      parentId: input.parentId ?? null,
      projectId: input.projectId ?? null,
      restricted: input.restricted ?? false,
      createdBy: actorUserId(actor),
    })
    return id
  }).pipe(Effect.orDie)

export interface EntityRow {
  readonly id: EntityId
  readonly type: EntityType
  readonly title: string
  readonly parentId: EntityId | null
  readonly projectId: ProjectId | null
  readonly restricted: boolean
  readonly version: number
  readonly createdBy: string | null
}

/** Loads a live entity of `type` with a row lock, or fails with NotFound. */
export const lockEntity = (id: EntityId, type: EntityType) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: entities.id,
        type: entities.type,
        title: entities.title,
        parentId: entities.parentId,
        projectId: entities.projectId,
        restricted: entities.restricted,
        version: entities.version,
        createdBy: entities.createdBy,
      })
      .from(entities)
      .where(and(eq(entities.id, id), eq(entities.type, type), isNull(entities.deletedAt)))
      .for("update")
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: type, id })
    return row as EntityRow
  })

/**
 * Optimistic concurrency: fails with Conflict when the client edited an older version.
 * `current` lets the client show both versions to merge.
 */
export const checkVersion = (row: EntityRow, expected: number | undefined, current?: unknown) =>
  expected === undefined || expected === row.version
    ? Effect.void
    : Effect.fail(
        new Conflict({
          message: `This ${row.type} changed since you loaded it`,
          current: current ?? { version: row.version },
        }),
      )

export interface EntityChanges {
  readonly title?: string
  readonly searchText?: string
  readonly parentId?: EntityId | null
  readonly projectId?: ProjectId | null
  readonly restricted?: boolean
}

/** Applies changes, bumps the version and returns the new version. */
export const touchEntity = (id: EntityId, changes: EntityChanges = {}) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .update(entities)
      .set({ ...changes, updatedAt: new Date(), version: sql`${entities.version} + 1` })
      .where(eq(entities.id, id))
      .returning({ version: entities.version })
    return row!.version
  }).pipe(Effect.orDie)

/** Soft delete; a purge job removes rows after the retention window. */
export const softDeleteEntity = (id: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .update(entities)
      .set({ deletedAt: new Date(), updatedAt: new Date(), version: sql`${entities.version} + 1` })
      .where(eq(entities.id, id))
  }).pipe(Effect.orDie)
