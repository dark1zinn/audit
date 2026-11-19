import {
  accessEntries,
  boards,
  entities,
  labels,
  projects,
  teams,
  userProfiles,
} from "@audit/db/schema"
import type { BoardId, EntityId, LabelId, ProjectId } from "@audit/domain/ids"
import type { AccessEntry, Label } from "@audit/domain/projects/schema"
import { Db } from "@audit/platform/database"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { loadBoard } from "./board-read.ts"
import { projectDetail, projectSummary } from "./read.ts"

/** Projects the caller can see in the sidebar; restricted projects they cannot read are excluded. */
export const sidebarProjects = () =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const visible = yield* authz.visible(sql`${projects.id}`)
    const rows = yield* db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(entities, eq(entities.id, projects.id))
      .where(and(isNull(entities.deletedAt), visible))
      .orderBy(asc(projects.key))
      .pipe(Effect.orDie)
    return yield* Effect.forEach(rows, (row) => projectSummary(row.id as ProjectId))
  })

/**
 * Every project, for workspace admins. Projects the admin holds no role on come back as metadata
 * only (key, status, no name, no default board).
 */
export const adminProjects = () =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireCapability("private.read")
    const rows = yield* db
      .select({ id: projects.id })
      .from(projects)
      .orderBy(asc(projects.key))
      .pipe(Effect.orDie)
    return yield* Effect.forEach(rows, (row) => projectSummary(row.id as ProjectId))
  })

export const projectDetailFor = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("project.read", projectId)
    return yield* projectDetail(projectId)
  })

export const projectBoards = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireOn("project.read", projectId)
    const rows = yield* db
      .select({ id: boards.id })
      .from(boards)
      .innerJoin(entities, eq(entities.id, boards.id))
      .where(and(eq(boards.projectId, projectId), isNull(entities.deletedAt)))
      .orderBy(asc(sql`${boards.position} collate "C"`))
      .pipe(Effect.orDie)
    return yield* Effect.forEach(rows, (row) => loadBoard(row.id as BoardId))
  })

export const boardFor = (boardId: BoardId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("board.read", boardId)
    return yield* loadBoard(boardId)
  })

export const projectLabels = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireOn("project.read", projectId)
    const rows = yield* db
      .select({
        id: labels.id,
        projectId: labels.projectId,
        name: labels.name,
        color: labels.color,
      })
      .from(labels)
      .where(eq(labels.projectId, projectId))
      .orderBy(asc(labels.name))
      .pipe(Effect.orDie)
    return rows.map((row): Label => ({
      id: row.id as LabelId,
      projectId: row.projectId as ProjectId,
      name: row.name,
      color: row.color,
    }))
  })

/** Explicit grants on a project, with human-readable principal names. */
export const projectAccess = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireOn("project.manage_access", projectId)
    const entries = yield* db
      .select({
        resourceId: accessEntries.resourceId,
        principalType: accessEntries.principalType,
        principalId: accessEntries.principalId,
        principalRole: accessEntries.principalRole,
        role: accessEntries.role,
      })
      .from(accessEntries)
      .where(eq(accessEntries.resourceId, projectId))
      .pipe(Effect.orDie)
    const userIds = entries.flatMap((entry) =>
      entry.principalType === "user" && entry.principalId ? [entry.principalId] : [],
    )
    const teamIds = entries.flatMap((entry) =>
      entry.principalType === "team" && entry.principalId ? [entry.principalId] : [],
    )
    const users = userIds.length
      ? yield* db
          .select({ id: userProfiles.userId, name: userProfiles.displayName })
          .from(userProfiles)
          .where(inArray(userProfiles.userId, userIds))
          .pipe(Effect.orDie)
      : []
    const teamRows = teamIds.length
      ? yield* db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, teamIds))
          .pipe(Effect.orDie)
      : []
    const userName = new Map(users.map((row) => [row.id, row.name]))
    const teamName = new Map(teamRows.map((row) => [row.id, row.name]))
    return entries.map((entry): AccessEntry => {
      const principalId = entry.principalId ?? entry.principalRole ?? ""
      const principalName =
        entry.principalType === "user"
          ? (userName.get(principalId) ?? "")
          : entry.principalType === "team"
            ? (teamName.get(principalId) ?? "")
            : (entry.principalRole ?? "")
      return {
        resourceId: entry.resourceId as EntityId,
        principalType: entry.principalType,
        principalId,
        principalName,
        role: entry.role,
      }
    })
  })
