/**
 * Task, comment, relation, watch and saved-filter writes. Every write runs through
 * `Command.make`: authorize first, then the transaction records the trail, emits events, syncs
 * references and enqueues jobs.
 */
import {
  boardColumns,
  comments,
  entities,
  labels,
  projects,
  references,
  savedFilters,
  taskAssignees,
  taskLabels,
  tasks,
  watchers,
} from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import type { ColumnCategory } from "@audit/domain/projects/schema"
import {
  BoardId,
  ColumnId,
  CommentId,
  EntityId,
  LabelId,
  ProjectId,
  TaskId,
  UserId,
} from "@audit/domain/ids"
import { keyBetween, needsRebalance } from "@audit/domain/ordering"
import {
  BulkAssignInput,
  BulkDeleteInput,
  BulkLabelInput,
  BulkMoveInput,
  Comment,
  CreateCommentInput,
  CreateSavedFilterInput,
  CreateTaskInput,
  LinkInput,
  MoveTaskInput,
  SavedFilter,
  TaskCard,
  UpdateCommentInput,
  UpdateTaskInput,
} from "@audit/domain/tasks/schema"
import { Db } from "@audit/platform/database"
import { Effect, Schema } from "effect"
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { boundAnchor, cleanRichDoc } from "../rich-text.ts"
import { currentUser } from "../current-user.ts"
import { boardRow } from "../projects/board-read.ts"
import { assertWritable } from "../projects/read.ts"
import { boardRebalance } from "../projects/rebalance.ts"
import {
  checkVersion,
  createEntity,
  lockEntity,
  softDeleteEntity,
  touchEntity,
} from "../entities.ts"
import { syncReferences } from "../references.ts"
import { taskSearchText } from "../search/text.ts"
import { record, emit, diff } from "../trail.ts"
import { Jobs } from "@audit/platform/jobs"
import { taskRows, toCards } from "./cards.ts"
import { extractMentions } from "@audit/editor/mentions"
import { notify, notifyWatchers, plainText, watch } from "../notifications/notify.ts"
import { completedAtFor } from "./state.ts"

const invalid = (message: string, field?: string) =>
  new ValidationError({ message, ...(field === undefined ? {} : { field }) })

/** Mutable snapshot of a task row used by the write commands. */
interface TaskState {
  readonly id: TaskId
  readonly projectId: ProjectId
  readonly boardId: BoardId
  readonly columnId: ColumnId
  readonly columnCategory: ColumnCategory
  readonly position: string
  readonly title: string
  readonly parentId: EntityId | null
  readonly priority: string
  readonly completedAt: Date | null
  readonly version: number
  readonly key: string
}

/** Locks a live task (FOR UPDATE on its entity row) and loads its board state. */
const loadTaskState = (taskId: TaskId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const lock = yield* lockEntity(taskId, "task")
    const [row] = yield* db
      .select({
        boardId: tasks.boardId,
        columnId: tasks.columnId,
        number: tasks.number,
        position: tasks.position,
        priority: tasks.priority,
        completedAt: tasks.completedAt,
        category: boardColumns.category,
        projectKey: projects.key,
      })
      .from(tasks)
      .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, taskId))
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFound({ entity: "task", id: taskId })
    const state: TaskState = {
      id: taskId,
      projectId: lock.projectId as ProjectId,
      boardId: row.boardId as BoardId,
      columnId: row.columnId as ColumnId,
      columnCategory: row.category as ColumnCategory,
      position: row.position,
      title: lock.title,
      parentId: lock.parentId,
      priority: row.priority,
      completedAt: row.completedAt,
      version: lock.version,
      key: `${row.projectKey}-${row.number}`,
    }
    return state
  })

const taskEvent = (
  kind: "created" | "updated" | "moved" | "deleted" | "restored",
  state: TaskState,
  version: number,
  actorId: UserId | null,
) =>
  emit({
    _tag: "TaskChanged",
    kind,
    entityId: state.id,
    projectId: state.projectId,
    actorId,
    version,
    boardId: state.boardId,
    columnId: state.columnId,
    columnCategory: state.columnCategory,
    position: state.position,
    title: state.title,
    priority: state.priority as "none",
    key: state.key,
  })

const taskCard = (taskId: TaskId) =>
  Effect.gen(function* () {
    const cards = yield* toCards(yield* taskRows([sql`${tasks.id} = ${taskId}`]))
    const card = cards[0]
    if (!card) return yield* new NotFound({ entity: "task", id: taskId })
    return card
  })

/** Ids of live subtasks under `rootId`, all depths. */
const liveDescendants = (rootId: TaskId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const found: EntityId[] = []
    let frontier: EntityId[] = [rootId]
    while (frontier.length > 0) {
      const rows = yield* db
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            inArray(entities.parentId, frontier),
            eq(entities.type, "task"),
            isNull(entities.deletedAt),
          ),
        )
        .pipe(Effect.orDie)
      frontier = rows.map((row) => row.id as EntityId)
      found.push(...frontier)
    }
    return found
  })

/** Rejects a parent that is not a task on the same board, or that would create a cycle. */
const requireParent = (parentId: TaskId, boardId: BoardId, self: TaskId | null) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ boardId: tasks.boardId })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .where(and(eq(tasks.id, parentId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    if (!row || row.boardId !== boardId) {
      return yield* invalid("Parent must be a task on this board", "parentId")
    }
    let current: EntityId | null = parentId
    for (let depth = 0; current !== null && current !== boardId && depth < 100; depth++) {
      if (current === self) return yield* invalid("A task cannot be its own ancestor", "parentId")
      const parents: ReadonlyArray<{ readonly parentId: string | null }> = yield* db
        .select({ parentId: entities.parentId })
        .from(entities)
        .where(eq(entities.id, current))
        .pipe(Effect.orDie)
      current = (parents[0]?.parentId ?? null) as EntityId | null
    }
  })

/** Position for a task placed after `afterTaskId` (null: first; undefined: last) in a column. */
const placeInColumn = (
  columnId: ColumnId,
  afterTaskId: TaskId | null | undefined,
  movingId: TaskId | null,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const siblings = yield* db
      .select({ id: tasks.id, position: tasks.position })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .where(
        and(
          eq(tasks.columnId, columnId),
          movingId === null ? undefined : ne(tasks.id, movingId),
          isNull(entities.deletedAt),
        ),
      )
      .orderBy(asc(sql`${tasks.position} collate "C"`))
      .pipe(Effect.orDie)
    if (afterTaskId === undefined) return keyBetween(siblings.at(-1)?.position ?? null, null)
    if (afterTaskId === null) return keyBetween(null, siblings[0]?.position ?? null)
    const index = siblings.findIndex((s) => s.id === afterTaskId)
    if (index < 0) {
      return yield* invalid("afterTaskId must be a live task in the target column", "afterTaskId")
    }
    return keyBetween(siblings[index]!.position, siblings[index + 1]?.position ?? null)
  })

/** Enqueues a board rebalance when a key grew too long. */
const rebalanceIfNeeded = (boardId: BoardId, position: string) =>
  Effect.gen(function* () {
    if (!needsRebalance(position)) return
    const jobs = yield* Jobs
    yield* jobs.enqueue(boardRebalance, { boardId }, { singletonKey: boardId })
  })

/** Column in `boardId`; fails when the column is missing or belongs to another board. */
const columnOnBoard = (columnId: ColumnId, boardId: BoardId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ category: boardColumns.category, boardId: boardColumns.boardId })
      .from(boardColumns)
      .where(eq(boardColumns.id, columnId))
      .pipe(Effect.orDie)
    if (!row || row.boardId !== boardId) {
      return yield* invalid("Column must belong to this board", "columnId")
    }
    return row.category as ColumnCategory
  })

/** Assignees must be able to see the task. Adds and removes are deltas. */
const addAssignees = (task: TaskState, userIds: ReadonlyArray<UserId>, actor: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const existing = yield* db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, task.id))
      .pipe(Effect.orDie)
    const known = new Set(existing.map((row) => row.userId))
    for (const userId of new Set(userIds)) {
      if (known.has(userId)) continue
      const role = yield* authz.roleOn(userId, task.id)
      if (role === null) return yield* invalid("Assignee cannot see this task", "assignees")
      yield* db
        .insert(taskAssignees)
        .values({ taskId: task.id, userId })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
      yield* watch(task.id, userId)
      if (userId !== actor) {
        yield* notify({
          userId,
          kind: "task_assigned",
          entityId: task.id,
          projectId: task.projectId,
          actorId: actor,
          payload: { taskKey: task.key, title: task.title },
          groupKey: `assigned:${task.id}`,
        })
      }
    }
  })

const removeAssignees = (task: TaskState, userIds: ReadonlyArray<UserId>, actor: UserId) =>
  userIds.length === 0
    ? Effect.void
    : Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .delete(taskAssignees)
          .where(
            and(eq(taskAssignees.taskId, task.id), inArray(taskAssignees.userId, [...userIds])),
          )
          .pipe(Effect.orDie)
        for (const userId of userIds) {
          yield* notify({
            userId,
            kind: "task_unassigned",
            entityId: task.id,
            projectId: task.projectId,
            actorId: actor,
            payload: { taskKey: task.key, title: task.title },
            groupKey: `unassigned:${task.id}:${userId}`,
          })
        }
      })

/** Labels must belong to the task's project. */
const addLabels = (taskId: TaskId, projectId: ProjectId, labelIds: ReadonlyArray<LabelId>) =>
  Effect.gen(function* () {
    const db = yield* Db
    const unique = [...new Set(labelIds)]
    if (unique.length === 0) return
    const found = yield* db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.projectId, projectId), inArray(labels.id, unique)))
      .pipe(Effect.orDie)
    if (found.length !== unique.length) return yield* invalid("Unknown label", "labels")
    yield* db
      .insert(taskLabels)
      .values(unique.map((labelId) => ({ taskId, labelId })))
      .onConflictDoNothing()
      .pipe(Effect.orDie)
  })

const removeLabels = (taskId: TaskId, labelIds: ReadonlyArray<LabelId>) =>
  labelIds.length === 0
    ? Effect.void
    : Effect.gen(function* () {
        const db = yield* Db
        yield* db
          .delete(taskLabels)
          .where(and(eq(taskLabels.taskId, taskId), inArray(taskLabels.labelId, [...labelIds])))
          .pipe(Effect.orDie)
      })

const currentAssignees = (taskId: TaskId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, taskId))
      .pipe(Effect.orDie)
    return rows.map((row) => row.userId as UserId)
  })

const currentLabels = (taskId: TaskId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const rows = yield* db
      .select({ labelId: taskLabels.labelId })
      .from(taskLabels)
      .where(eq(taskLabels.taskId, taskId))
      .pipe(Effect.orDie)
    return rows.map((row) => row.labelId as LabelId)
  })

/** Authorize for delete: the creator may delete their own task with `task.delete_own`. */
const requireTaskDelete = (taskId: TaskId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const userId = actorUserId(yield* CurrentActor)
    const [row] = yield* db
      .select({ createdBy: entities.createdBy })
      .from(entities)
      .where(eq(entities.id, taskId))
      .pipe(Effect.orDie)
    const ownDelete =
      userId !== null && row?.createdBy === userId
        ? yield* authz.can("task.delete_own", taskId)
        : false
    if (ownDelete) return
    yield* authz.requireOn("task.delete", taskId)
  })

/** Soft-deletes a task and its subtasks, emitting one event per removed task. */
const softDeleteTask = (taskId: TaskId, actor: UserId) =>
  Effect.gen(function* () {
    const state = yield* loadTaskState(taskId)
    const descendants = yield* liveDescendants(taskId)
    const all = [taskId, ...(descendants as TaskId[])]
    for (const id of all) {
      const current = id === taskId ? state : yield* loadTaskState(id)
      yield* softDeleteEntity(id)
      yield* record({
        action: "task.deleted",
        entityId: id,
        entityType: "task",
        projectId: current.projectId,
        details: { key: current.key },
      })
      yield* taskEvent("deleted", current, current.version + 1, actor)
    }
  })

/**
 * Makes `sourceId`'s `mention` references match the mentions in `body` (people, teams, tasks,
 * docs, messages, events, projects, each with its surrounding text) and notifies newly mentioned
 * people, who must be able to see the task.
 */
const syncMentions = (
  sourceId: EntityId,
  taskId: TaskId,
  body: unknown,
  actor: UserId,
  payload: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const state = yield* loadTaskState(taskId)
    const mentions = extractMentions(body)
    const added = yield* syncReferences(
      sourceId,
      "mention",
      mentions.map((m) => ({ targetId: m.id as EntityId, snippet: m.snippet })),
    )
    const people = new Set(mentions.filter((m) => m.type === "user").map((m) => m.id))
    for (const targetId of added) {
      if (targetId === actor || !people.has(targetId)) continue
      yield* notify({
        userId: targetId as UserId,
        kind: "mention",
        entityId: taskId,
        projectId: state.projectId,
        actorId: actor,
        payload: { taskKey: state.key, ...payload },
        groupKey: `mention:${taskId}`,
      })
    }
  })

const loadComment = (commentId: CommentId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: comments.id,
        taskId: comments.targetId,
        authorId: comments.authorId,
        body: comments.body,
        bodyText: comments.bodyText,
        anchor: comments.anchor,
        parentCommentId: comments.parentCommentId,
        resolvedAt: comments.resolvedAt,
        editedAt: comments.editedAt,
        createdAt: entities.createdAt,
        version: entities.version,
      })
      .from(comments)
      .innerJoin(entities, eq(entities.id, comments.id))
      .where(eq(comments.id, commentId))
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFound({ entity: "comment", id: commentId })
    return {
      ...row,
      id: row.id as CommentId,
      taskId: row.taskId as TaskId,
      authorId: row.authorId as UserId,
      parentCommentId: row.parentCommentId as CommentId | null,
    }
  })

/** Author and target task of a live comment. */
const commentTarget = (commentId: CommentId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ taskId: comments.targetId, authorId: comments.authorId })
      .from(comments)
      .innerJoin(entities, eq(entities.id, comments.id))
      .where(and(eq(comments.id, commentId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFound({ entity: "comment", id: commentId })
    return { taskId: row.taskId as TaskId, authorId: row.authorId }
  })

// ---------------------------------------------------------------------------------------------
// Tasks

export const createTask = Command.make("task.create", {
  input: Schema.Struct({ boardId: BoardId, ...CreateTaskInput.fields }),
  output: TaskCard,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.create", input.boardId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("task.create")
      const board = yield* boardRow(input.boardId)
      yield* assertWritable(board.projectId)

      const [project] = yield* db
        .select({ key: projects.key, taskSeq: projects.taskSeq })
        .from(projects)
        .where(eq(projects.id, board.projectId))
        .for("update")
        .pipe(Effect.orDie)
      const number = (project?.taskSeq ?? 0) + 1
      yield* db
        .update(projects)
        .set({ taskSeq: number })
        .where(eq(projects.id, board.projectId))
        .pipe(Effect.orDie)

      const columnId =
        input.columnId ??
        (yield* db
          .select({ id: boardColumns.id })
          .from(boardColumns)
          .where(eq(boardColumns.boardId, input.boardId))
          .orderBy(asc(sql`${boardColumns.position} collate "C"`))
          .limit(1)
          .pipe(Effect.orDie))[0]?.id
      if (columnId === undefined) return yield* invalid("Board has no columns", "columnId")
      const category = yield* columnOnBoard(columnId as ColumnId, input.boardId)
      if (input.parentId !== undefined && input.parentId !== null) {
        yield* requireParent(input.parentId, input.boardId, null)
      }

      const position = yield* placeInColumn(columnId as ColumnId, undefined, null)
      const description = input.description
        ? yield* cleanRichDoc(input.description, "description", "doc")
        : input.description
      const key = `${project?.key ?? ""}-${number}`
      const id = (yield* createEntity({
        type: "task",
        title: input.title,
        searchText: taskSearchText(key, description),
        parentId: input.parentId ?? input.boardId,
        projectId: board.projectId,
      })) as TaskId
      yield* db
        .insert(tasks)
        .values({
          id,
          boardId: input.boardId,
          columnId: columnId as ColumnId,
          projectId: board.projectId,
          number,
          position,
          priority: input.priority ?? "none",
          startAt: input.startAt ?? null,
          dueAt: input.dueAt ?? null,
          estimate: input.estimate ?? null,
          description: description ?? null,
          completedAt: completedAtFor(category, null, new Date()),
        })
        .pipe(Effect.orDie)

      const state: TaskState = {
        id,
        projectId: board.projectId,
        boardId: input.boardId,
        columnId: columnId as ColumnId,
        columnCategory: category,
        position,
        title: input.title,
        parentId: input.parentId ?? input.boardId,
        priority: input.priority ?? "none",
        completedAt: completedAtFor(category, null, new Date()),
        version: 1,
        key: `${project?.key ?? ""}-${number}`,
      }
      yield* addAssignees(state, input.assignees ?? [], userId)
      yield* addLabels(id, board.projectId, input.labels ?? [])
      yield* watch(id, userId)
      if (description !== undefined && description !== null) {
        yield* syncMentions(id, id, description, userId, {})
      }
      yield* record({
        action: "task.created",
        entityId: id,
        entityType: "task",
        projectId: board.projectId,
        details: { key: state.key },
      })
      const card = yield* taskCard(id)
      yield* taskEvent("created", state, card.version, userId)
      return card
    }),
})

export const updateTask = Command.make("task.update", {
  input: Schema.Struct({ taskId: TaskId, ...UpdateTaskInput.fields }),
  output: TaskCard,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.update", input.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("task.update")
      const state = yield* loadTaskState(input.taskId)
      const lock = yield* lockEntity(input.taskId, "task")
      yield* checkVersion(lock, input.version, { task: input.taskId })
      yield* assertWritable(state.projectId)

      if (input.parentId !== undefined && input.parentId !== null) {
        yield* requireParent(input.parentId, state.boardId, input.taskId)
      }
      const description = input.description
        ? yield* cleanRichDoc(input.description, "description", "doc")
        : input.description

      const patch: Partial<typeof tasks.$inferInsert> = {}
      if (input.priority !== undefined) patch.priority = input.priority
      if (input.startAt !== undefined) patch.startAt = input.startAt
      if (input.estimate !== undefined) patch.estimate = input.estimate
      if (description !== undefined) patch.description = description
      if (input.dueAt !== undefined) {
        patch.dueAt = input.dueAt
        patch.dueNotifiedAt = null
        patch.overdueNotifiedAt = null
      }
      if (Object.keys(patch).length > 0) {
        yield* db.update(tasks).set(patch).where(eq(tasks.id, input.taskId)).pipe(Effect.orDie)
      }
      if (description !== undefined) {
        yield* syncMentions(input.taskId, input.taskId, description, userId, {})
      }

      if (input.assignees !== undefined) {
        const current = yield* currentAssignees(input.taskId)
        const next = new Set(input.assignees)
        yield* removeAssignees(
          state,
          current.filter((id) => !next.has(id)),
          userId,
        )
        yield* addAssignees(
          state,
          input.assignees.filter((id) => !current.includes(id)),
          userId,
        )
      }
      if (input.labels !== undefined) {
        const current = yield* currentLabels(input.taskId)
        const next = new Set(input.labels)
        yield* removeLabels(
          input.taskId,
          current.filter((id) => !next.has(id)),
        )
        yield* addLabels(
          input.taskId,
          state.projectId,
          input.labels.filter((id) => !current.includes(id)),
        )
      }

      const nextTitle = input.title ?? state.title
      const version = yield* touchEntity(input.taskId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId ?? state.boardId } : {}),
        ...(description !== undefined
          ? { searchText: taskSearchText(state.key, description) }
          : {}),
      })
      yield* record({
        action: "task.updated",
        entityId: input.taskId,
        entityType: "task",
        projectId: state.projectId,
        diff: diff(
          { title: state.title, priority: state.priority },
          { title: nextTitle, priority: input.priority ?? state.priority },
          ["title", "priority"],
        ),
      })
      yield* taskEvent(
        "updated",
        { ...state, title: nextTitle, priority: input.priority ?? state.priority },
        version,
        userId,
      )
      if (input.title !== undefined || input.dueAt !== undefined) {
        yield* notifyWatchers({
          entityId: input.taskId,
          projectId: state.projectId,
          actorId: userId,
          kind: "task_changed",
          payload: { taskKey: state.key, title: nextTitle },
          groupKey: `task_changed:${input.taskId}`,
        })
      }
      return yield* taskCard(input.taskId)
    }),
})

export const moveTask = Command.make("task.move", {
  input: Schema.Struct({ taskId: TaskId, ...MoveTaskInput.fields }),
  output: TaskCard,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.move", input.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("task.move")
      const state = yield* loadTaskState(input.taskId)
      const lock = yield* lockEntity(input.taskId, "task")
      yield* checkVersion(lock, input.version, { task: input.taskId })
      yield* assertWritable(state.projectId)

      const category = yield* columnOnBoard(input.columnId, state.boardId)
      const position = yield* placeInColumn(input.columnId, input.afterTaskId, input.taskId)
      const completedAt = completedAtFor(category, state.completedAt, new Date())
      yield* db
        .update(tasks)
        .set({ columnId: input.columnId, position, completedAt })
        .where(eq(tasks.id, input.taskId))
        .pipe(Effect.orDie)
      const version = yield* touchEntity(input.taskId)
      yield* record({
        action: "task.moved",
        entityId: input.taskId,
        entityType: "task",
        projectId: state.projectId,
        details: { from: state.columnId, to: input.columnId },
      })
      const next = { ...state, columnId: input.columnId, columnCategory: category, position }
      yield* taskEvent("moved", next, version, userId)
      yield* rebalanceIfNeeded(state.boardId, position)
      return yield* taskCard(input.taskId)
    }),
})

export const deleteTask = Command.make("task.delete", {
  input: Schema.Struct({ taskId: TaskId, version: Schema.optionalKey(Schema.Number) }),
  output: Schema.Void,
  authorize: (input) => requireTaskDelete(input.taskId),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("task.delete")
      const state = yield* loadTaskState(input.taskId)
      const lock = yield* lockEntity(input.taskId, "task")
      yield* checkVersion(lock, input.version, { task: input.taskId })
      yield* assertWritable(state.projectId)
      yield* softDeleteTask(input.taskId, userId)
    }),
})

export const bulkMoveTasks = Command.make("task.bulk_move", {
  input: BulkMoveInput,
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      for (const id of input.taskIds) yield* authz.requireOn("task.move", id)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("task.bulk_move")
      for (const taskId of input.taskIds) {
        const state = yield* loadTaskState(taskId)
        yield* assertWritable(state.projectId)
        const category = yield* columnOnBoard(input.columnId, state.boardId)
        const db = yield* Db
        const position = yield* placeInColumn(input.columnId, undefined, taskId)
        const completedAt = completedAtFor(category, state.completedAt, new Date())
        yield* db
          .update(tasks)
          .set({ columnId: input.columnId, position, completedAt })
          .where(eq(tasks.id, taskId))
          .pipe(Effect.orDie)
        const version = yield* touchEntity(taskId)
        yield* record({
          action: "task.moved",
          entityId: taskId,
          entityType: "task",
          projectId: state.projectId,
          details: { from: state.columnId, to: input.columnId },
        })
        yield* taskEvent(
          "moved",
          { ...state, columnId: input.columnId, columnCategory: category, position },
          version,
          userId,
        )
        yield* rebalanceIfNeeded(state.boardId, position)
      }
    }),
})

export const bulkAssignTasks = Command.make("task.bulk_assign", {
  input: BulkAssignInput,
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      for (const id of input.taskIds) yield* authz.requireOn("task.update", id)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("task.bulk_assign")
      for (const taskId of input.taskIds) {
        const state = yield* loadTaskState(taskId)
        yield* assertWritable(state.projectId)
        yield* addAssignees(state, input.add, userId)
        yield* removeAssignees(state, input.remove, userId)
        const version = yield* touchEntity(taskId)
        yield* taskEvent("updated", state, version, userId)
      }
    }),
})

export const bulkLabelTasks = Command.make("task.bulk_label", {
  input: BulkLabelInput,
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      for (const id of input.taskIds) yield* authz.requireOn("task.update", id)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("task.bulk_label")
      for (const taskId of input.taskIds) {
        const state = yield* loadTaskState(taskId)
        yield* assertWritable(state.projectId)
        yield* addLabels(taskId, state.projectId, input.add)
        yield* removeLabels(taskId, input.remove)
        const version = yield* touchEntity(taskId)
        yield* taskEvent("updated", state, version, userId)
      }
    }),
})

export const bulkDeleteTasks = Command.make("task.bulk_delete", {
  input: BulkDeleteInput,
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      for (const id of input.taskIds) yield* requireTaskDelete(id)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("task.bulk_delete")
      for (const taskId of input.taskIds) {
        const state = yield* loadTaskState(taskId)
        yield* assertWritable(state.projectId)
        yield* softDeleteTask(taskId, userId)
      }
    }),
})

export const linkTask = Command.make("task.link", {
  input: Schema.Struct({ taskId: TaskId, ...LinkInput.fields }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.update", input.taskId)
      yield* authz.requireOn("task.read", input.targetId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("task.link")
      const state = yield* loadTaskState(input.taskId)
      yield* assertWritable(state.projectId)
      if (input.targetId === input.taskId)
        return yield* invalid("A task cannot link to itself", "targetId")
      yield* db
        .insert(references)
        .values({
          sourceId: input.taskId,
          targetId: input.targetId,
          kind: input.kind,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .pipe(Effect.orDie)
      const version = yield* touchEntity(input.taskId)
      yield* taskEvent("updated", state, version, userId)
    }),
})

export const unlinkTask = Command.make("task.unlink", {
  input: Schema.Struct({ taskId: TaskId, ...LinkInput.fields }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.update", input.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("task.unlink")
      const state = yield* loadTaskState(input.taskId)
      yield* assertWritable(state.projectId)
      yield* db
        .delete(references)
        .where(
          and(
            eq(references.sourceId, input.taskId),
            eq(references.targetId, input.targetId),
            eq(references.kind, input.kind),
          ),
        )
        .pipe(Effect.orDie)
      const version = yield* touchEntity(input.taskId)
      yield* taskEvent("updated", state, version, userId)
    }),
})

export const watchTaskCommand = Command.make("task.watch", {
  input: Schema.Struct({ taskId: TaskId }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.read", input.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("task.watch")
      yield* watch(input.taskId, userId)
    }),
})

export const unwatchTask = Command.make("task.unwatch", {
  input: Schema.Struct({ taskId: TaskId }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.read", input.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("task.unwatch")
      yield* db
        .delete(watchers)
        .where(and(eq(watchers.entityId, input.taskId), eq(watchers.userId, userId)))
        .pipe(Effect.orDie)
    }),
})

// ---------------------------------------------------------------------------------------------
// Comments

export const createComment = Command.make("comment.create", {
  input: Schema.Struct({ taskId: TaskId, ...CreateCommentInput.fields }),
  output: Comment,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireOn("task.comment", input.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("comment.create")
      const state = yield* loadTaskState(input.taskId)
      yield* assertWritable(state.projectId)
      if (input.parentCommentId !== undefined && input.parentCommentId !== null) {
        const [parent] = yield* db
          .select({ id: comments.id })
          .from(comments)
          .where(and(eq(comments.id, input.parentCommentId), eq(comments.targetId, input.taskId)))
          .pipe(Effect.orDie)
        if (!parent) return yield* invalid("Parent comment must be on this task", "parentCommentId")
      }
      const body = yield* cleanRichDoc(input.body, "body", "message")
      const id = (yield* createEntity({
        type: "comment",
        title: "",
        searchText: plainText(body),
        parentId: input.taskId,
        projectId: state.projectId,
      })) as CommentId
      yield* db
        .insert(comments)
        .values({
          id,
          targetId: input.taskId,
          authorId: userId,
          anchor: input.anchor ? yield* boundAnchor(input.anchor, "anchor") : null,
          body,
          bodyText: plainText(body),
          parentCommentId: input.parentCommentId ?? null,
        })
        .pipe(Effect.orDie)
      yield* watch(input.taskId, userId)
      yield* notifyWatchers({
        entityId: input.taskId,
        projectId: state.projectId,
        actorId: userId,
        kind: "comment_added",
        payload: { taskKey: state.key, title: state.title },
        groupKey: `comment:${input.taskId}`,
      })
      yield* syncMentions(id, input.taskId, body, userId, { commentId: id })
      yield* record({
        action: "comment.created",
        entityId: id,
        entityType: "comment",
        projectId: state.projectId,
        details: { taskKey: state.key },
      })
      yield* emit({
        _tag: "CommentChanged",
        kind: "created",
        entityId: id,
        projectId: state.projectId,
        actorId: userId,
        version: 1,
        taskId: input.taskId,
      })
      return yield* loadComment(id)
    }),
})

export const updateComment = Command.make("comment.update", {
  input: Schema.Struct({ commentId: CommentId, ...UpdateCommentInput.fields }),
  output: Comment,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const userId = yield* currentUser("comment.update")
      const target = yield* commentTarget(input.commentId)
      if (target.authorId !== userId) {
        return yield* new Forbidden({
          action: "comment.update",
          message: "Only the author can edit this comment",
        })
      }
      yield* authz.requireOn("task.comment", target.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("comment.update")
      const target = yield* commentTarget(input.commentId)
      const state = yield* loadTaskState(target.taskId)
      const lock = yield* lockEntity(input.commentId, "comment")
      yield* checkVersion(lock, input.version, { comment: input.commentId })
      yield* assertWritable(state.projectId)
      const body =
        input.body === undefined ? undefined : yield* cleanRichDoc(input.body, "body", "message")
      if (body !== undefined) {
        yield* db
          .update(comments)
          .set({
            body,
            bodyText: plainText(body),
            editedAt: new Date(),
          })
          .where(eq(comments.id, input.commentId))
          .pipe(Effect.orDie)
        yield* syncMentions(input.commentId, target.taskId, body, userId, {
          commentId: input.commentId,
        })
      }
      if (input.resolved !== undefined) {
        yield* db
          .update(comments)
          .set({ resolvedAt: input.resolved ? new Date() : null })
          .where(eq(comments.id, input.commentId))
          .pipe(Effect.orDie)
      }
      const version = yield* touchEntity(
        input.commentId,
        body !== undefined ? { searchText: plainText(body) } : {},
      )
      yield* emit({
        _tag: "CommentChanged",
        kind: "updated",
        entityId: input.commentId,
        projectId: state.projectId,
        actorId: userId,
        version,
        taskId: target.taskId,
      })
      return yield* loadComment(input.commentId)
    }),
})

export const deleteComment = Command.make("comment.delete", {
  input: Schema.Struct({ commentId: CommentId }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const userId = yield* currentUser("comment.delete")
      const target = yield* commentTarget(input.commentId)
      if (target.authorId === userId) {
        yield* authz.requireOn("task.comment", target.taskId)
        return
      }
      yield* authz.requireOn("task.delete", target.taskId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const userId = yield* currentUser("comment.delete")
      const target = yield* commentTarget(input.commentId)
      const state = yield* loadTaskState(target.taskId)
      yield* assertWritable(state.projectId)
      yield* softDeleteEntity(input.commentId)
      yield* emit({
        _tag: "CommentChanged",
        kind: "deleted",
        entityId: input.commentId,
        projectId: state.projectId,
        actorId: userId,
        version: 0,
        taskId: target.taskId,
      })
    }),
})

// ---------------------------------------------------------------------------------------------
// Saved filters and notifications

export const createSavedFilter = Command.make("saved_filter.create", {
  input: Schema.Struct({
    projectId: Schema.optionalKey(ProjectId),
    ...CreateSavedFilterInput.fields,
  }),
  output: SavedFilter,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      if (input.projectId !== undefined) yield* authz.requireOn("project.read", input.projectId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("saved_filter.create")
      const [row] = yield* db
        .insert(savedFilters)
        .values({
          userId,
          projectId: input.projectId ?? null,
          name: input.name,
          filter: input.filter,
        })
        .returning({
          id: savedFilters.id,
          projectId: savedFilters.projectId,
          name: savedFilters.name,
          filter: savedFilters.filter,
        })
        .pipe(Effect.orDie)
      return {
        id: row!.id as EntityId,
        projectId: (row!.projectId as ProjectId | null) ?? null,
        name: row!.name,
        filter: row!.filter as typeof input.filter,
      }
    }),
})

export const deleteSavedFilter = Command.make("saved_filter.delete", {
  input: Schema.Struct({ filterId: EntityId }),
  output: Schema.Void,
  authorize: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUser("saved_filter.delete")
      const [row] = yield* db
        .select({ userId: savedFilters.userId })
        .from(savedFilters)
        .where(eq(savedFilters.id, input.filterId))
        .pipe(Effect.orDie)
      if (!row || row.userId !== userId) {
        return yield* new NotFound({ entity: "saved_filter", id: input.filterId })
      }
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      yield* db.delete(savedFilters).where(eq(savedFilters.id, input.filterId)).pipe(Effect.orDie)
    }),
})
