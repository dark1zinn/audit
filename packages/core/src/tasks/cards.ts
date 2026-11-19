/**
 * Shared task reads. Every list goes through `taskRows`, which applies the caller's visibility, so
 * no query can leak a restricted task by forgetting a check.
 */
import {
  boardColumns,
  comments,
  entities,
  labels,
  projects,
  taskAssignees,
  taskLabels,
  tasks,
} from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { ValidationError } from "@audit/domain/errors"
import type { BoardId, ColumnId, LabelId, ProjectId, TaskId, UserId } from "@audit/domain/ids"
import type { ColumnCategory } from "@audit/domain/projects/schema"
import type { Priority, TaskCard, TaskFilter } from "@audit/domain/tasks/schema"
import { Db } from "@audit/platform/database"
import { and, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"

export interface TaskRow {
  readonly id: TaskId
  readonly boardId: BoardId
  readonly columnId: ColumnId
  readonly columnCategory: ColumnCategory
  readonly projectId: ProjectId
  readonly projectKey: string
  readonly number: number
  readonly title: string
  readonly priority: Priority
  readonly position: string
  readonly startAt: Date | null
  readonly dueAt: Date | null
  readonly estimate: number | null
  readonly description: Record<string, unknown> | null
  readonly completedAt: Date | null
  readonly parentId: TaskId | null
  readonly creatorId: UserId | null
  readonly restricted: boolean
  readonly version: number
  readonly updatedAt: Date
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

/** Visible, live tasks matching `conditions`, in no particular order. */
export const taskRows = (conditions: ReadonlyArray<SQL | undefined>) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const visible = yield* authz.visible(sql`${entities.id}`)
    const rows = yield* db
      .select({
        id: tasks.id,
        boardId: tasks.boardId,
        columnId: tasks.columnId,
        columnCategory: boardColumns.category,
        projectId: tasks.projectId,
        projectKey: projects.key,
        number: tasks.number,
        title: entities.title,
        priority: tasks.priority,
        position: tasks.position,
        startAt: tasks.startAt,
        dueAt: tasks.dueAt,
        estimate: tasks.estimate,
        description: tasks.description,
        completedAt: tasks.completedAt,
        parentId: entities.parentId,
        creatorId: entities.createdBy,
        restricted: entities.restricted,
        version: entities.version,
        updatedAt: entities.updatedAt,
      })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(isNull(entities.deletedAt), visible, ...conditions))
      .pipe(Effect.orDie)
    return rows.map((row): TaskRow => ({
      ...row,
      id: row.id as TaskId,
      boardId: row.boardId as BoardId,
      columnId: row.columnId as ColumnId,
      columnCategory: row.columnCategory as ColumnCategory,
      projectId: row.projectId as ProjectId,
      priority: row.priority as Priority,
      description: row.description,
      parentId: row.parentId as TaskId | null,
      creatorId: row.creatorId as UserId | null,
    }))
  })

/** Converts a filter to SQL over `tasks`/`boardColumns`. `mentionsMe` needs the caller's id. */
export const filterConditions = (filter: TaskFilter) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor
    const me = actorUserId(actor)
    const conditions: Array<SQL | undefined> = []
    if (filter.assigneeId !== undefined) {
      conditions.push(
        sql`exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${filter.assigneeId})`,
      )
    }
    if (filter.labelId !== undefined) {
      conditions.push(
        sql`exists (select 1 from ${taskLabels} where ${taskLabels.taskId} = ${tasks.id} and ${taskLabels.labelId} = ${filter.labelId})`,
      )
    }
    if (filter.priority !== undefined) conditions.push(eq(tasks.priority, filter.priority))
    if (filter.category !== undefined) conditions.push(eq(boardColumns.category, filter.category))
    if (filter.dueAfter !== undefined) {
      conditions.push(gte(tasks.dueAt, yield* parseDate("dueAfter", filter.dueAfter)))
    }
    if (filter.dueBefore !== undefined) {
      conditions.push(lt(tasks.dueAt, yield* parseDate("dueBefore", filter.dueBefore)))
    }
    if (filter.text !== undefined && filter.text.trim() !== "") {
      conditions.push(sql`${entities.title} ilike ${`%${escapeLike(filter.text.trim())}%`}`)
    }
    if (filter.mentionsMe === true && me !== null) {
      conditions.push(
        sql`(exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${me})
          or exists (select 1 from ${comments} join "references" on "references"."source_id" = ${comments.id}
            where ${comments.targetId} = ${tasks.id} and "references"."kind" = 'mention' and "references"."target_id" = ${me}))`,
      )
    }
    return conditions
  })

const parseDate = (field: string, value: string) =>
  Effect.gen(function* () {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return yield* new ValidationError({ message: `${field} must be a date`, field })
    }
    return date
  })

/** Builds cards for rows with batched lookups for assignees, labels, subtasks and comments. */
export const toCards = (rows: ReadonlyArray<TaskRow>) =>
  Effect.gen(function* () {
    const db = yield* Db
    const ids = rows.map((row) => row.id)
    if (ids.length === 0) return [] as TaskCard[]
    const assigneeRows = yield* db
      .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(inArray(taskAssignees.taskId, ids))
      .pipe(Effect.orDie)
    const labelRows = yield* db
      .select({ taskId: taskLabels.taskId, labelId: taskLabels.labelId })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(inArray(taskLabels.taskId, ids))
      .pipe(Effect.orDie)
    const subtaskRows = yield* db
      .select({
        parentId: entities.parentId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(${tasks.completedAt})::int`,
      })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .where(and(inArray(entities.parentId, ids), isNull(entities.deletedAt)))
      .groupBy(entities.parentId)
      .pipe(Effect.orDie)
    const commentRows = yield* db
      .select({ targetId: comments.targetId, count: sql<number>`count(*)::int` })
      .from(comments)
      .innerJoin(entities, eq(entities.id, comments.id))
      .where(and(inArray(comments.targetId, ids), isNull(entities.deletedAt)))
      .groupBy(comments.targetId)
      .pipe(Effect.orDie)

    const assignees = groupBy(assigneeRows, (row) => row.taskId)
    const labelIds = groupBy(labelRows, (row) => row.taskId)
    const subtasks = new Map(subtaskRows.map((row) => [row.parentId, row]))
    const commentCounts = new Map(commentRows.map((row) => [row.targetId, row.count]))

    return rows.map((row): TaskCard => ({
      id: row.id,
      key: `${row.projectKey}-${row.number}`,
      projectId: row.projectId,
      projectKey: row.projectKey,
      boardId: row.boardId,
      columnId: row.columnId,
      columnCategory: row.columnCategory,
      title: row.title,
      priority: row.priority,
      position: row.position,
      assignees: (assignees.get(row.id) ?? []).map((item) => item.userId as UserId),
      labels: (labelIds.get(row.id) ?? []).map((item) => item.labelId as LabelId),
      parentId: row.parentId,
      startAt: row.startAt,
      dueAt: row.dueAt,
      estimate: row.estimate,
      completedAt: row.completedAt,
      subtaskCount: subtasks.get(row.id)?.total ?? 0,
      subtasksDone: subtasks.get(row.id)?.done ?? 0,
      commentCount: commentCounts.get(row.id) ?? 0,
      version: row.version,
      updatedAt: row.updatedAt,
    }))
  })

const groupBy = <T, K>(items: ReadonlyArray<T>, key: (item: T) => K) => {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const bucket = map.get(key(item))
    if (bucket === undefined) map.set(key(item), [item])
    else bucket.push(item)
  }
  return map
}
