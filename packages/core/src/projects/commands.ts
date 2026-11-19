/**
 * Project, access, board, column and label writes. Each one is a named command: authorize first,
 * then change rows, bump versions, record the trail entry and emit the event in one transaction.
 */
import {
  accessEntries,
  boardColumns,
  boards,
  entities,
  labels,
  projects,
  tasks,
  teamMembers,
  teams,
} from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Conflict, Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { BoardId, ColumnId, EntityId, LabelId, ProjectId, TeamId, Uuid } from "@audit/domain/ids"
import { type ResourceAction } from "@audit/domain/permissions"
import { type ResourceRole, WorkspaceRole } from "@audit/domain/roles"
import {
  Board,
  BoardColumn,
  CreateBoardInput,
  CreateColumnInput,
  CreateLabelInput,
  CreateProjectInput,
  DeleteColumnInput,
  DeleteProjectInput,
  Label,
  MoveColumnInput,
  PrincipalInput,
  ProjectDetail,
  RenameBoardInput,
  RevokeAccessInput,
  SetBoardRestrictedInput,
  SetRestrictedInput,
  UpdateColumnInput,
  UpdateLabelInput,
  UpdateProjectInput,
  ProjectVisibility,
} from "@audit/domain/projects/schema"
import { Db } from "@audit/platform/database"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { checkVersion, createEntity, lockEntity, touchEntity } from "../entities.ts"
import { diff, emit, record } from "../trail.ts"
import { initialKeys, keyBetween, keysBetween } from "@audit/domain/ordering"
import { assertWritable, projectRow, projectRowAny, projectDetail } from "./read.ts"
import { boardColumnsWithCounts, loadBoard, boardRow } from "./board-read.ts"
import { completedAtFor } from "../tasks/state.ts"

// --- Shared helpers ---------------------------------------------------------

const invalid = (message: string, field?: string) =>
  new ValidationError({ message, ...(field === undefined ? {} : { field }) })

const requireOn = (action: ResourceAction, id: EntityId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn(action, id)
  })

const requireCapability = (capability: "projects.create" | "access.override") =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability(capability)
  })

const currentUser = (action: string) =>
  Effect.gen(function* () {
    const userId = actorUserId(yield* CurrentActor)
    if (userId === null) return yield* new Forbidden({ action, message: "Only people can do this" })
    return userId
  })

/** Positions for the default columns of a new board. */
const defaultColumns = [
  { name: "Backlog", category: "backlog" },
  { name: "To do", category: "todo" },
  { name: "In progress", category: "in_progress" },
  { name: "Done", category: "done" },
] as const

const ColumnRow = Schema.Struct({ id: Schema.String, position: Schema.String })
type ColumnRow = typeof ColumnRow.Type

/** Key for a column placed after `afterId` (`undefined`: last, `null`: first). */
const placeAfter = (columns: ReadonlyArray<ColumnRow>, afterId: string | null | undefined) =>
  Effect.gen(function* () {
    if (afterId === undefined) return keyBetween(columns.at(-1)?.position ?? null, null)
    if (afterId === null) return keyBetween(null, columns[0]?.position ?? null)
    const index = columns.findIndex((column) => column.id === afterId)
    if (index < 0) return yield* new NotFound({ entity: "column", id: afterId })
    return keyBetween(columns[index]!.position, columns[index + 1]?.position ?? null)
  })

const orderedColumns = (boardId: BoardId) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* db
      .select({ id: boardColumns.id, position: boardColumns.position })
      .from(boardColumns)
      .where(eq(boardColumns.boardId, boardId))
      .orderBy(asc(sql`${boardColumns.position} collate "C"`))
      .pipe(Effect.orDie)
  })

const columnRow = (columnId: ColumnId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ id: boardColumns.id, boardId: boardColumns.boardId })
      .from(boardColumns)
      .where(eq(boardColumns.id, columnId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "column", id: columnId })
    return { id: row.id as ColumnId, boardId: row.boardId as BoardId }
  })

/** The project a board belongs to (also checks the board is live). */
const boardProject = (boardId: BoardId) =>
  Effect.gen(function* () {
    const row = yield* boardRow(boardId)
    return row.projectId
  })

const requireBoardWritable = (boardId: BoardId) =>
  Effect.gen(function* () {
    const projectId = yield* boardProject(boardId)
    yield* assertWritable(projectId)
    return projectId
  })

const readOnlyCheck = (projectId: ProjectId) => assertWritable(projectId)

const rowsOrConflict = <A>(effect: Effect.Effect<A, unknown, never>, message: string) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Command.isUniqueViolation(error)
          ? Effect.fail(new Conflict({ message }))
          : Effect.die(error),
      onSuccess: (value) => Effect.succeed(value),
    }),
  )

// --- Principals and access -------------------------------------------------

export interface ResolvedPrincipal {
  readonly principalType: "user" | "team"
  readonly principalId: string
  readonly principalRole: null
}
export interface ResolvedRole {
  readonly principalType: "role"
  readonly principalId: null
  readonly principalRole: WorkspaceRole
}

/** Validates a principal and decodes its id. */
export const resolvePrincipal = (principal: {
  readonly principalType: "user" | "team" | "role"
  readonly principalId: string
}): Effect.Effect<ResolvedPrincipal | ResolvedRole, ValidationError> =>
  Effect.gen(function* () {
    if (principal.principalType === "role") {
      const role = yield* Schema.decodeUnknownEffect(WorkspaceRole)(principal.principalId).pipe(
        Effect.mapError(() => invalid("Unknown workspace role", "principalId")),
      )
      return { principalType: "role", principalId: null, principalRole: role } as const
    }
    const id = yield* Schema.decodeUnknownEffect(Uuid)(principal.principalId).pipe(
      Effect.mapError(() => invalid("Invalid principal id", "principalId")),
    )
    return { principalType: principal.principalType, principalId: id, principalRole: null } as const
  })

const matchesPrincipal = (principal: ResolvedPrincipal | ResolvedRole) =>
  principal.principalType === "role"
    ? and(
        eq(accessEntries.principalType, "role"),
        eq(accessEntries.principalRole, principal.principalRole),
      )
    : and(
        eq(accessEntries.principalType, principal.principalType),
        eq(accessEntries.principalId, principal.principalId),
      )

/** Replaces the principal's grant on a container and rebuilds its materialised access. */
const grantAccess = (resourceId: EntityId, input: typeof PrincipalInput.Type) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const userId = yield* currentUser("access.grant")
    const principal = yield* resolvePrincipal(input)
    yield* db
      .delete(accessEntries)
      .where(and(eq(accessEntries.resourceId, resourceId), matchesPrincipal(principal)))
      .pipe(Effect.orDie)
    yield* db
      .insert(accessEntries)
      .values({
        resourceId,
        principalType: principal.principalType,
        principalId: principal.principalId,
        principalRole: principal.principalRole,
        role: input.role,
        grantedBy: userId,
      })
      .pipe(Effect.orDie)
    yield* authz.rebuild({ containerId: resourceId })
    return principal
  })

const revokeAccess = (resourceId: EntityId, input: typeof RevokeAccessInput.Type) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const principal = yield* resolvePrincipal(input)
    yield* db
      .delete(accessEntries)
      .where(and(eq(accessEntries.resourceId, resourceId), matchesPrincipal(principal)))
      .pipe(Effect.orDie)
    yield* authz.rebuild({ containerId: resourceId })
  })

/**
 * Workspace visibility is stored as role grants on the project. Replaces them to match the
 * project's visibility and member role, so switching visibility takes effect immediately.
 */
const syncWorkspaceRoleAccess = (
  projectId: ProjectId,
  visibility: ProjectVisibility,
  memberRole: ResourceRole,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .delete(accessEntries)
      .where(and(eq(accessEntries.resourceId, projectId), eq(accessEntries.principalType, "role")))
      .pipe(Effect.orDie)
    if (visibility !== "workspace") return
    yield* db
      .insert(accessEntries)
      .values(
        (["owner", "admin", "member"] as const).map((role) => ({
          resourceId: projectId,
          principalType: "role" as const,
          principalId: null,
          principalRole: role,
          role: memberRole,
        })),
      )
      .pipe(Effect.orDie)
  })

// --- Projects ---------------------------------------------------------------

export const createProject = Command.make("project.create", {
  input: CreateProjectInput,
  output: ProjectDetail,
  authorize: () => requireCapability("projects.create"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("project.create")
      const projectId = Bun.randomUUIDv7() as ProjectId
      const teamId = Bun.randomUUIDv7() as TeamId
      const boardId = Bun.randomUUIDv7() as BoardId
      const visibility = input.visibility ?? "workspace"
      const memberRole = input.memberRole ?? "editor"
      const teamName = `${input.name} team`

      yield* createEntity({
        id: projectId,
        type: "project",
        title: input.name,
        searchText: `${input.key} ${input.name}`,
        projectId,
        restricted: visibility === "restricted",
      })
      yield* rowsOrConflict(
        db.insert(projects).values({
          id: projectId,
          key: input.key,
          name: input.name,
          leadUserId: userId,
          visibility,
          memberRole,
          status: "active",
          taskSeq: 0,
        }),
        "A project with this key already exists",
      )

      // The project's own team holds the project's members; its lead can change settings.
      yield* createEntity({ id: teamId, type: "team", title: teamName, projectId })
      yield* rowsOrConflict(
        db
          .insert(teams)
          .values({
            id: teamId,
            name: teamName,
            slug: `${input.key.toLowerCase()}-team`,
            kind: "project",
            projectId,
          })
          .pipe(Effect.orDie),
        "A team with this slug already exists",
      )
      yield* db.insert(teamMembers).values({ teamId, userId, role: "lead" }).pipe(Effect.orDie)

      const accessRows = [
        {
          resourceId: projectId,
          principalType: "team" as const,
          principalId: teamId,
          principalRole: null,
          role: "editor" as const,
          grantedBy: userId,
        },
        {
          resourceId: projectId,
          principalType: "user" as const,
          principalId: userId,
          principalRole: null,
          role: "manager" as const,
          grantedBy: userId,
        },
        ...(visibility === "workspace"
          ? (["owner", "admin", "member"] as const).map((role) => ({
              resourceId: projectId,
              principalType: "role" as const,
              principalId: null,
              principalRole: role,
              role: memberRole,
              grantedBy: userId,
            }))
          : []),
      ]
      yield* db.insert(accessEntries).values(accessRows).pipe(Effect.orDie)

      yield* createEntity({
        id: boardId,
        type: "board",
        title: "Board",
        parentId: projectId,
        projectId,
      })
      yield* db
        .insert(boards)
        .values({ id: boardId, projectId, name: "Board", position: keyBetween(null, null) })
        .pipe(Effect.orDie)
      const keys = initialKeys(defaultColumns.length)
      yield* db
        .insert(boardColumns)
        .values(
          defaultColumns.map((column, index) => ({
            boardId,
            name: column.name,
            category: column.category,
            position: keys[index]!,
          })),
        )
        .pipe(Effect.orDie)

      yield* authz.rebuild({ containerId: projectId })
      yield* record({
        action: "project.created",
        entityId: projectId,
        entityType: "project",
        projectId,
      })
      yield* emit({
        _tag: "ProjectChanged",
        kind: "created",
        entityId: projectId,
        projectId,
        actorId: userId,
        version: 1,
        key: input.key,
        visibility,
      })
      return yield* projectDetail(projectId)
    }),
})

export const updateProject = Command.make("project.update", {
  input: Schema.Struct({ projectId: ProjectId, ...UpdateProjectInput.fields }),
  output: ProjectDetail,
  authorize: (input) => requireOn("project.settings", input.projectId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("project.update")
      const lock = yield* lockEntity(input.projectId, "project")
      yield* checkVersion(lock, input.version)
      yield* assertWritable(input.projectId)
      const before = yield* projectRow(input.projectId)

      const visibilityChanged =
        input.visibility !== undefined && input.visibility !== before.visibility
      const after = {
        name: input.name ?? before.name,
        leadUserId: input.leadUserId === undefined ? before.leadUserId : input.leadUserId,
        visibility: input.visibility ?? before.visibility,
        memberRole: input.memberRole ?? before.memberRole,
      }
      yield* db
        .update(projects)
        .set(after)
        .where(eq(projects.id, input.projectId))
        .pipe(Effect.orDie)
      yield* touchEntity(input.projectId, {
        title: after.name,
        restricted: after.visibility === "restricted",
      })
      if (visibilityChanged || after.memberRole !== before.memberRole) {
        yield* syncWorkspaceRoleAccess(input.projectId, after.visibility, after.memberRole)
        yield* authz.rebuild({ containerId: input.projectId })
      }
      yield* record({
        action: "project.updated",
        entityId: input.projectId,
        entityType: "project",
        projectId: input.projectId,
        diff: diff(
          {
            name: before.name,
            leadUserId: before.leadUserId,
            visibility: before.visibility,
            memberRole: before.memberRole,
          },
          after,
          ["name", "leadUserId", "visibility", "memberRole"],
        ),
      })
      yield* emit({
        _tag: "ProjectChanged",
        kind: "updated",
        entityId: input.projectId,
        projectId: input.projectId,
        actorId: userId,
        version: lock.version + 1,
        key: before.key,
        visibility: after.visibility,
      })
      return yield* projectDetail(input.projectId)
    }),
})

/** Shared body of archive and unarchive: flips the status and emits the matching event. */
const setArchived = (projectId: ProjectId, archived: boolean) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser("project.archive")
    const before = yield* projectRow(projectId)
    if ((before.status === "archived") === archived) {
      return yield* new Conflict({
        message: archived ? "Project is already archived" : "Project is not archived",
      })
    }
    yield* db
      .update(projects)
      .set({ status: archived ? "archived" : "active" })
      .where(eq(projects.id, projectId))
      .pipe(Effect.orDie)
    const version = yield* touchEntity(projectId)
    yield* record({
      action: archived ? "project.archived" : "project.unarchived",
      entityId: projectId,
      entityType: "project",
      projectId,
    })
    yield* emit({
      _tag: "ProjectChanged",
      kind: archived ? "archived" : "unarchived",
      entityId: projectId,
      projectId,
      actorId: userId,
      version,
      key: before.key,
      visibility: before.visibility,
    })
    return yield* projectDetail(projectId)
  })

export const archiveProject = Command.make("project.archive", {
  input: Schema.Struct({ projectId: ProjectId }),
  output: ProjectDetail,
  authorize: (input) => requireOn("project.archive", input.projectId),
  run: (input) => setArchived(input.projectId, true),
})

export const unarchiveProject = Command.make("project.unarchive", {
  input: Schema.Struct({ projectId: ProjectId }),
  output: ProjectDetail,
  authorize: (input) => requireOn("project.archive", input.projectId),
  run: (input) => setArchived(input.projectId, false),
})

/**
 * Soft-deletes the project and everything under it, all stamped with one timestamp so restore can
 * bring back exactly what this delete removed.
 */
export const deleteProject = Command.make("project.delete", {
  input: Schema.Struct({ projectId: ProjectId, ...DeleteProjectInput.fields }),
  output: Schema.Void,
  authorize: (input) => requireOn("project.delete", input.projectId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("project.delete")
      const row = yield* projectRow(input.projectId)
      if (input.confirm !== row.key) {
        return yield* invalid("Type the project key to confirm", "confirm")
      }
      const now = new Date()
      yield* db
        .update(entities)
        .set({ deletedAt: now, updatedAt: now, version: sql`${entities.version} + 1` })
        .where(and(eq(entities.projectId, input.projectId), sql`${entities.deletedAt} is null`))
        .pipe(Effect.orDie)
      yield* authz.rebuild({ containerId: input.projectId })
      yield* record({
        action: "project.deleted",
        entityId: input.projectId,
        entityType: "project",
        projectId: input.projectId,
      })
      yield* emit({
        _tag: "ProjectChanged",
        kind: "deleted",
        entityId: input.projectId,
        projectId: input.projectId,
        actorId: userId,
        version: row.version + 1,
        key: row.key,
        visibility: row.visibility,
      })
    }),
})

/** Undoes a project delete: restores rows stamped with the project's own deletion time. */
export const restoreProject = Command.make("project.restore", {
  input: Schema.Struct({ projectId: ProjectId }),
  output: ProjectDetail,
  authorize: () => requireCapability("access.override"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("project.restore")
      const row = yield* projectRowAny(input.projectId)
      if (row.deletedAt === null) {
        return yield* new Conflict({ message: "Project is not deleted" })
      }
      yield* db
        .update(entities)
        .set({ deletedAt: null, updatedAt: new Date(), version: sql`${entities.version} + 1` })
        .where(and(eq(entities.projectId, input.projectId), eq(entities.deletedAt, row.deletedAt)))
        .pipe(Effect.orDie)
      yield* authz.rebuild({ containerId: input.projectId })
      yield* record({
        action: "project.restored",
        entityId: input.projectId,
        entityType: "project",
        projectId: input.projectId,
      })
      yield* emit({
        _tag: "ProjectChanged",
        kind: "restored",
        entityId: input.projectId,
        projectId: input.projectId,
        actorId: userId,
        version: row.version + 1,
        key: row.key,
        visibility: row.visibility,
      })
      return yield* projectDetail(input.projectId)
    }),
})

/** Sets the project's visibility: `restricted` projects are visible only to granted people. */
export const setProjectRestricted = Command.make("project.set_restricted", {
  input: Schema.Struct({ projectId: ProjectId, ...SetRestrictedInput.fields }),
  output: ProjectDetail,
  authorize: (input) => requireOn("project.manage_access", input.projectId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("project.set_restricted")
      const row = yield* projectRow(input.projectId)
      const visibility: ProjectVisibility = input.restricted ? "restricted" : "workspace"
      yield* db
        .update(projects)
        .set({ visibility })
        .where(eq(projects.id, input.projectId))
        .pipe(Effect.orDie)
      const version = yield* touchEntity(input.projectId, { restricted: input.restricted })
      yield* syncWorkspaceRoleAccess(input.projectId, visibility, row.memberRole)
      yield* authz.rebuild({ containerId: input.projectId })
      yield* record({
        action: "project.visibility_changed",
        entityId: input.projectId,
        entityType: "project",
        projectId: input.projectId,
        diff: diff({ visibility: row.visibility }, { visibility }, ["visibility"]),
      })
      yield* emit({
        _tag: "ProjectChanged",
        kind: "access_changed",
        entityId: input.projectId,
        projectId: input.projectId,
        actorId: userId,
        version,
        key: row.key,
        visibility,
      })
      return yield* projectDetail(input.projectId)
    }),
})

export const grantProjectAccess = Command.make("project.grant", {
  input: Schema.Struct({ projectId: ProjectId, ...PrincipalInput.fields }),
  output: Schema.Void,
  authorize: (input) => requireOn("project.manage_access", input.projectId),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("project.grant")
      const row = yield* projectRow(input.projectId)
      yield* grantAccess(input.projectId, input)
      yield* record({
        action: "project.access_granted",
        entityId: input.projectId,
        entityType: "project",
        projectId: input.projectId,
        details: {
          principalType: input.principalType,
          principalId: input.principalId,
          role: input.role,
        },
      })
      yield* emit({
        _tag: "ProjectChanged",
        kind: "access_changed",
        entityId: input.projectId,
        projectId: input.projectId,
        actorId: userId,
        version: null,
        key: row.key,
        visibility: row.visibility,
      })
    }),
})

export const revokeProjectAccess = Command.make("project.revoke", {
  input: Schema.Struct({ projectId: ProjectId, ...RevokeAccessInput.fields }),
  output: Schema.Void,
  authorize: (input) => requireOn("project.manage_access", input.projectId),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("project.revoke")
      const row = yield* projectRow(input.projectId)
      yield* revokeAccess(input.projectId, input)
      yield* record({
        action: "project.access_revoked",
        entityId: input.projectId,
        entityType: "project",
        projectId: input.projectId,
        details: { principalType: input.principalType, principalId: input.principalId },
      })
      yield* emit({
        _tag: "ProjectChanged",
        kind: "access_changed",
        entityId: input.projectId,
        projectId: input.projectId,
        actorId: userId,
        version: null,
        key: row.key,
        visibility: row.visibility,
      })
    }),
})

// --- Boards -----------------------------------------------------------------

export const createBoard = Command.make("board.create", {
  input: Schema.Struct({ projectId: ProjectId, ...CreateBoardInput.fields }),
  output: Board,
  authorize: (input) => requireOn("board.create", input.projectId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("board.create")
      yield* readOnlyCheck(input.projectId)
      const [last] = yield* db
        .select({ position: boards.position })
        .from(boards)
        .where(eq(boards.projectId, input.projectId))
        .orderBy(sql`${boards.position} collate "C" desc`)
        .limit(1)
        .pipe(Effect.orDie)
      const boardId = Bun.randomUUIDv7() as BoardId
      yield* createEntity({
        id: boardId,
        type: "board",
        title: input.name,
        parentId: input.projectId,
        projectId: input.projectId,
      })
      yield* db
        .insert(boards)
        .values({
          id: boardId,
          projectId: input.projectId,
          name: input.name,
          position: keyBetween(last?.position ?? null, null),
        })
        .pipe(Effect.orDie)
      const keys = initialKeys(defaultColumns.length)
      yield* db
        .insert(boardColumns)
        .values(
          defaultColumns.map((column, index) => ({
            boardId,
            name: column.name,
            category: column.category,
            position: keys[index]!,
          })),
        )
        .pipe(Effect.orDie)
      yield* authz.rebuild({ containerId: input.projectId })
      yield* record({
        action: "board.created",
        entityId: boardId,
        entityType: "board",
        projectId: input.projectId,
      })
      yield* emit({
        _tag: "BoardChanged",
        kind: "created",
        entityId: boardId,
        projectId: input.projectId,
        actorId: userId,
        version: 1,
        boardId,
        columnId: null,
      })
      return yield* loadBoard(boardId)
    }),
})

export const renameBoard = Command.make("board.rename", {
  input: Schema.Struct({ boardId: BoardId, ...RenameBoardInput.fields }),
  output: Board,
  authorize: (input) => requireOn("board.update", input.boardId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("board.rename")
      const lock = yield* lockEntity(input.boardId, "board")
      yield* checkVersion(lock, input.version)
      const projectId = yield* requireBoardWritable(input.boardId)
      yield* db
        .update(boards)
        .set({ name: input.name })
        .where(eq(boards.id, input.boardId))
        .pipe(Effect.orDie)
      const version = yield* touchEntity(input.boardId, { title: input.name })
      yield* record({
        action: "board.renamed",
        entityId: input.boardId,
        entityType: "board",
        projectId,
        diff: diff({ name: lock.title }, { name: input.name }, ["name"]),
      })
      yield* emit({
        _tag: "BoardChanged",
        kind: "renamed",
        entityId: input.boardId,
        projectId,
        actorId: userId,
        version,
        boardId: input.boardId,
        columnId: null,
      })
      return yield* loadBoard(input.boardId)
    }),
})

export const deleteBoard = Command.make("board.delete", {
  input: Schema.Struct({ boardId: BoardId }),
  output: Schema.Void,
  authorize: (input) => requireOn("board.delete", input.boardId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const userId = yield* currentUser("board.delete")
      const projectId = yield* requireBoardWritable(input.boardId)
      const now = new Date()
      // The board and its tasks go together; restoring the project brings them back.
      yield* db
        .update(entities)
        .set({ deletedAt: now, updatedAt: now, version: sql`${entities.version} + 1` })
        .where(
          sql`(${entities.id} = ${input.boardId} or ${entities.id} in (select id from tasks where board_id = ${input.boardId})) and ${entities.deletedAt} is null`,
        )
        .pipe(Effect.orDie)
      yield* authz.rebuild({ containerId: projectId })
      yield* record({
        action: "board.deleted",
        entityId: input.boardId,
        entityType: "board",
        projectId,
      })
      yield* emit({
        _tag: "BoardChanged",
        kind: "deleted",
        entityId: input.boardId,
        projectId,
        actorId: userId,
        version: null,
        boardId: input.boardId,
        columnId: null,
      })
    }),
})

export const setBoardRestricted = Command.make("board.set_restricted", {
  input: Schema.Struct({ boardId: BoardId, ...SetBoardRestrictedInput.fields }),
  output: Board,
  authorize: (input) => requireOn("board.manage_access", input.boardId),
  run: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const userId = yield* currentUser("board.set_restricted")
      const projectId = yield* requireBoardWritable(input.boardId)
      const version = yield* touchEntity(input.boardId, { restricted: input.restricted })
      yield* authz.rebuild({ containerId: input.boardId })
      yield* record({
        action: "board.restricted_changed",
        entityId: input.boardId,
        entityType: "board",
        projectId,
        details: { restricted: input.restricted },
      })
      yield* emit({
        _tag: "BoardChanged",
        kind: "restricted",
        entityId: input.boardId,
        projectId,
        actorId: userId,
        version,
        boardId: input.boardId,
        columnId: null,
      })
      return yield* loadBoard(input.boardId)
    }),
})

export const grantBoardAccess = Command.make("board.grant", {
  input: Schema.Struct({ boardId: BoardId, ...PrincipalInput.fields }),
  output: Schema.Void,
  authorize: (input) => requireOn("board.manage_access", input.boardId),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("board.grant")
      const projectId = yield* boardProject(input.boardId)
      yield* grantAccess(input.boardId, input)
      yield* emit({
        _tag: "BoardChanged",
        kind: "access_changed",
        entityId: input.boardId,
        projectId,
        actorId: userId,
        version: null,
        boardId: input.boardId,
        columnId: null,
      })
    }),
})

export const revokeBoardAccess = Command.make("board.revoke", {
  input: Schema.Struct({ boardId: BoardId, ...RevokeAccessInput.fields }),
  output: Schema.Void,
  authorize: (input) => requireOn("board.manage_access", input.boardId),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("board.revoke")
      const projectId = yield* boardProject(input.boardId)
      yield* revokeAccess(input.boardId, input)
      yield* emit({
        _tag: "BoardChanged",
        kind: "access_changed",
        entityId: input.boardId,
        projectId,
        actorId: userId,
        version: null,
        boardId: input.boardId,
        columnId: null,
      })
    }),
})

// --- Columns ----------------------------------------------------------------

export const createColumn = Command.make("column.create", {
  input: Schema.Struct({ boardId: BoardId, ...CreateColumnInput.fields }),
  output: BoardColumn,
  authorize: (input) => requireOn("board.update", input.boardId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("column.create")
      const projectId = yield* requireBoardWritable(input.boardId)
      const position = yield* placeAfter(yield* orderedColumns(input.boardId), input.afterColumnId)
      const [row] = yield* db
        .insert(boardColumns)
        .values({
          boardId: input.boardId,
          name: input.name,
          category: input.category,
          position,
          wipLimit: input.wipLimit ?? null,
        })
        .returning({ id: boardColumns.id })
        .pipe(Effect.orDie)
      yield* record({
        action: "column.created",
        entityId: input.boardId,
        entityType: "board",
        projectId,
        details: { columnId: row!.id, name: input.name },
      })
      yield* emit({
        _tag: "BoardChanged",
        kind: "column_created",
        entityId: input.boardId,
        projectId,
        actorId: userId,
        version: null,
        boardId: input.boardId,
        columnId: row!.id as ColumnId,
      })
      return {
        id: row!.id as ColumnId,
        boardId: input.boardId,
        name: input.name,
        category: input.category,
        position,
        wipLimit: input.wipLimit ?? null,
        taskCount: 0,
      }
    }),
})

export const updateColumn = Command.make("column.update", {
  input: Schema.Struct({ columnId: ColumnId, ...UpdateColumnInput.fields }),
  output: BoardColumn,
  authorize: (input) =>
    Effect.gen(function* () {
      const row = yield* columnRow(input.columnId)
      yield* requireOn("board.update", row.boardId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("column.update")
      const row = yield* columnRow(input.columnId)
      const projectId = yield* requireBoardWritable(row.boardId)
      const [before] = yield* db
        .select()
        .from(boardColumns)
        .where(eq(boardColumns.id, input.columnId))
        .pipe(Effect.orDie)
      const changes = {
        name: input.name ?? before!.name,
        category: input.category ?? before!.category,
        wipLimit: input.wipLimit === undefined ? before!.wipLimit : input.wipLimit,
      }
      yield* db
        .update(boardColumns)
        .set(changes)
        .where(eq(boardColumns.id, input.columnId))
        .pipe(Effect.orDie)
      yield* record({
        action: "column.updated",
        entityId: row.boardId,
        entityType: "board",
        projectId,
        details: { columnId: input.columnId },
      })
      yield* emit({
        _tag: "BoardChanged",
        kind: "column_updated",
        entityId: row.boardId,
        projectId,
        actorId: userId,
        version: null,
        boardId: row.boardId,
        columnId: input.columnId,
      })
      return {
        id: input.columnId,
        boardId: row.boardId,
        name: changes.name,
        category: changes.category,
        position: before!.position,
        wipLimit: changes.wipLimit,
        taskCount: 0,
      }
    }),
})

export const moveColumn = Command.make("column.move", {
  input: Schema.Struct({ columnId: ColumnId, ...MoveColumnInput.fields }),
  output: BoardColumn,
  authorize: (input) =>
    Effect.gen(function* () {
      const row = yield* columnRow(input.columnId)
      yield* requireOn("board.update", row.boardId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("column.move")
      const row = yield* columnRow(input.columnId)
      const projectId = yield* requireBoardWritable(row.boardId)
      const others = (yield* orderedColumns(row.boardId)).filter(
        (column) => column.id !== input.columnId,
      )
      const position = yield* placeAfter(others, input.afterColumnId)
      yield* db
        .update(boardColumns)
        .set({ position })
        .where(eq(boardColumns.id, input.columnId))
        .pipe(Effect.orDie)
      yield* emit({
        _tag: "BoardChanged",
        kind: "column_moved",
        entityId: row.boardId,
        projectId,
        actorId: userId,
        version: null,
        boardId: row.boardId,
        columnId: input.columnId,
      })
      const updated = (yield* boardColumnsWithCounts(row.boardId)).find(
        (column) => column.id === input.columnId,
      )
      if (!updated) return yield* new NotFound({ entity: "column", id: input.columnId })
      return updated
    }),
})

/**
 * Deletes a column. Tasks in it move to `moveTasksTo` (same board, appended in their current order)
 * and their completion state follows the target column's category.
 */
export const deleteColumn = Command.make("column.delete", {
  input: Schema.Struct({ columnId: ColumnId, ...DeleteColumnInput.fields }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const row = yield* columnRow(input.columnId)
      yield* requireOn("board.delete", row.boardId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("column.delete")
      const row = yield* columnRow(input.columnId)
      const projectId = yield* requireBoardWritable(row.boardId)
      const moving = yield* db
        .select({ id: tasks.id, position: tasks.position, completedAt: tasks.completedAt })
        .from(tasks)
        .innerJoin(entities, eq(entities.id, tasks.id))
        .where(and(eq(tasks.columnId, input.columnId), sql`${entities.deletedAt} is null`))
        .orderBy(asc(sql`${tasks.position} collate "C"`))
        .pipe(Effect.orDie)
      if (moving.length > 0) {
        if (input.moveTasksTo === undefined || input.moveTasksTo === null) {
          return yield* invalid("Move the tasks to another column first", "moveTasksTo")
        }
        if (input.moveTasksTo === input.columnId) {
          return yield* invalid("Pick a different column", "moveTasksTo")
        }
        const target = yield* columnRow(input.moveTasksTo)
        if (target.boardId !== row.boardId) {
          return yield* invalid("The target column must be on the same board", "moveTasksTo")
        }
        const [targetColumn] = yield* db
          .select({ category: boardColumns.category, position: boardColumns.position })
          .from(boardColumns)
          .where(eq(boardColumns.id, input.moveTasksTo))
          .pipe(Effect.orDie)
        const [lastTask] = yield* db
          .select({ position: tasks.position })
          .from(tasks)
          .where(eq(tasks.columnId, input.moveTasksTo))
          .orderBy(sql`${tasks.position} desc`)
          .limit(1)
          .pipe(Effect.orDie)
        const keys = keysBetween(lastTask?.position ?? null, null, moving.length)
        const now = new Date()
        for (const [index, task] of moving.entries()) {
          yield* db
            .update(tasks)
            .set({
              columnId: input.moveTasksTo,
              position: keys[index]!,
              completedAt: completedAtFor(targetColumn!.category, task.completedAt, now),
            })
            .where(eq(tasks.id, task.id))
            .pipe(Effect.orDie)
        }
      }
      yield* db.delete(boardColumns).where(eq(boardColumns.id, input.columnId)).pipe(Effect.orDie)
      yield* record({
        action: "column.deleted",
        entityId: row.boardId,
        entityType: "board",
        projectId,
        details: { columnId: input.columnId, movedTasks: moving.length },
      })
      yield* emit({
        _tag: "BoardChanged",
        kind: "column_deleted",
        entityId: row.boardId,
        projectId,
        actorId: userId,
        version: null,
        boardId: row.boardId,
        columnId: input.columnId,
      })
    }),
})

// --- Labels -----------------------------------------------------------------

const labelProject = (labelId: LabelId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ projectId: labels.projectId })
      .from(labels)
      .where(eq(labels.id, labelId))
      .pipe(Effect.orDie)
    if (row === undefined) return yield* new NotFound({ entity: "label", id: labelId })
    return row.projectId as ProjectId
  })

export const createLabel = Command.make("label.create", {
  input: Schema.Struct({ projectId: ProjectId, ...CreateLabelInput.fields }),
  output: Label,
  authorize: (input) => requireOn("label.create", input.projectId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("label.create")
      yield* readOnlyCheck(input.projectId)
      const [row] = yield* rowsOrConflict(
        db
          .insert(labels)
          .values({ projectId: input.projectId, name: input.name, color: input.color })
          .returning({ id: labels.id }),
        "A label with this name already exists",
      )
      yield* emit({
        _tag: "BoardChanged",
        kind: "label_changed",
        entityId: input.projectId,
        projectId: input.projectId,
        actorId: userId,
        version: null,
        boardId: null,
        columnId: null,
      })
      return {
        id: row!.id as LabelId,
        projectId: input.projectId,
        name: input.name,
        color: input.color,
      }
    }),
})

export const updateLabel = Command.make("label.update", {
  input: Schema.Struct({ labelId: LabelId, ...UpdateLabelInput.fields }),
  output: Label,
  authorize: (input) =>
    Effect.gen(function* () {
      yield* requireOn("label.update", yield* labelProject(input.labelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("label.update")
      const projectId = yield* labelProject(input.labelId)
      yield* readOnlyCheck(projectId)
      const [before] = yield* db
        .select({ name: labels.name, color: labels.color })
        .from(labels)
        .where(eq(labels.id, input.labelId))
        .pipe(Effect.orDie)
      const after = { name: input.name ?? before!.name, color: input.color ?? before!.color }
      yield* rowsOrConflict(
        db.update(labels).set(after).where(eq(labels.id, input.labelId)).pipe(Effect.orDie),
        "A label with this name already exists",
      )
      yield* emit({
        _tag: "BoardChanged",
        kind: "label_changed",
        entityId: projectId,
        projectId,
        actorId: userId,
        version: null,
        boardId: null,
        columnId: null,
      })
      return { id: input.labelId, projectId, ...after }
    }),
})

export const deleteLabel = Command.make("label.delete", {
  input: Schema.Struct({ labelId: LabelId }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      yield* requireOn("label.delete", yield* labelProject(input.labelId))
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("label.delete")
      const projectId = yield* labelProject(input.labelId)
      yield* db.delete(labels).where(eq(labels.id, input.labelId)).pipe(Effect.orDie)
      yield* emit({
        _tag: "BoardChanged",
        kind: "label_changed",
        entityId: projectId,
        projectId,
        actorId: userId,
        version: null,
        boardId: null,
        columnId: null,
      })
    }),
})
