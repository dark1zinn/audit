/**
 * Project reads shared by commands (which return the new state) and queries (which list it).
 * Authorization is the caller's job; these only load rows and compute the caller's role.
 */
import { boards, entities, projects, tasks } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Forbidden, NotFound } from "@audit/domain/errors"
import type { BoardId, ProjectId, UserId } from "@audit/domain/ids"
import type { ProjectDetail, ProjectSummary } from "@audit/domain/projects/schema"
import { Db } from "@audit/platform/database"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"

/** A project row including soft-deleted ones (admin list, restore). */
export const projectRowAny = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        leadUserId: projects.leadUserId,
        visibility: projects.visibility,
        memberRole: projects.memberRole,
        status: projects.status,
        taskSeq: projects.taskSeq,
        version: entities.version,
        updatedAt: entities.updatedAt,
        deletedAt: entities.deletedAt,
      })
      .from(projects)
      .innerJoin(entities, eq(entities.id, projects.id))
      .where(eq(projects.id, projectId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "project", id: projectId })
    // The row boundary: uuid columns come back as plain strings; brand them once here.
    return {
      ...row,
      id: row.id as ProjectId,
      leadUserId: row.leadUserId as UserId | null,
    }
  })

/** A live (not soft-deleted) project row. */
export const projectRow = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const row = yield* projectRowAny(projectId)
    if (row.deletedAt !== null) return yield* new NotFound({ entity: "project", id: projectId })
    return row
  })

/** Fails with Forbidden when the project is archived; archived projects are read-only. */
export const assertWritable = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const row = yield* projectRow(projectId)
    if (row.status === "archived") {
      return yield* new Forbidden({ action: "write", message: "This project is archived" })
    }
  })

/** The default board is the first live board in position order. */
export const defaultBoardId = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ id: boards.id })
      .from(boards)
      .innerJoin(entities, eq(entities.id, boards.id))
      .where(and(eq(boards.projectId, projectId), isNull(entities.deletedAt)))
      .orderBy(sql`${boards.position} collate "C"`)
      .limit(1)
      .pipe(Effect.orDie)
    return row === undefined ? null : (row.id as BoardId)
  })

/** The caller's role on a project, `null` when none (and for the system actor). */
export const myProjectRole = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    const userId = actorUserId(yield* CurrentActor)
    return userId === null ? null : yield* authz.roleOn(userId, projectId)
  })

/**
 * Sidebar and admin shape. A project the caller holds no role on is metadata only: its name is
 * replaced by its key and it has no default board.
 */
export const projectSummary = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const row = yield* projectRowAny(projectId)
    const myRole = yield* myProjectRole(projectId)
    const metadataOnly = myRole === null
    const status = row.deletedAt !== null ? "deleted" : row.status
    return {
      id: row.id,
      key: row.key,
      name: metadataOnly ? row.key : row.name,
      status,
      visibility: row.visibility,
      memberRole: row.memberRole,
      myRole,
      metadataOnly,
      defaultBoardId: metadataOnly ? null : yield* defaultBoardId(projectId),
      version: row.version,
    } satisfies ProjectSummary
  })

export const projectDetail = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const row = yield* projectRow(projectId)
    const summary = yield* projectSummary(projectId)
    const [counts] = yield* db
      .select({
        taskCount: sql<number>`count(*)::int`,
        openTaskCount: sql<number>`count(*) filter (where ${tasks.completedAt} is null)::int`,
      })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .where(and(eq(tasks.projectId, projectId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    return {
      ...summary,
      leadUserId: row.leadUserId,
      taskCount: counts?.taskCount ?? 0,
      openTaskCount: counts?.openTaskCount ?? 0,
      // Projects keep no archive timestamp; the entity's last change is the archive time while archived.
      archivedAt: row.status === "archived" ? row.updatedAt : null,
    } satisfies ProjectDetail
  })
