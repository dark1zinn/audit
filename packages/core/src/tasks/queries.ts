import {
  boardColumns,
  comments,
  entities,
  labels,
  references,
  savedFilters,
  taskAssignees,
  tasks,
  trailEvents,
  userProfiles,
  watchers,
} from "@audit/db/schema"
import type {
  BoardId,
  ColumnId,
  CommentId,
  EntityId,
  ProjectId,
  TaskId,
  UserId,
} from "@audit/domain/ids"
import type {
  CalendarQuery,
  Priority,
  RelationKind,
  SavedFilter,
  TaskCard,
  TaskDetail,
  TaskFilter,
} from "@audit/domain/tasks/schema"
import { ListTasksQuery } from "@audit/domain/tasks/schema"
import { Db } from "@audit/platform/database"
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import { currentUser } from "../current-user.ts"
import { NotFound } from "@audit/domain/errors"
import { filterConditions, taskRows, toCards } from "./cards.ts"

const PRIORITY_RANK: Record<Priority, number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 }

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const compareDates = (a: Date | null, b: Date | null) => {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return a.getTime() - b.getTime()
}

const numberOf = (card: TaskCard) => Number(card.key.slice(card.key.lastIndexOf("-") + 1))

const sortCards = (cards: ReadonlyArray<TaskCard>, sort: string, dir: "asc" | "desc") => {
  const compare = (a: TaskCard, b: TaskCard): number => {
    switch (sort) {
      case "priority":
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      case "dueAt":
        return compareDates(a.dueAt, b.dueAt)
      case "updatedAt":
        return a.updatedAt.getTime() - b.updatedAt.getTime()
      case "number":
        return numberOf(a) - numberOf(b)
      default:
        return compareText(a.position, b.position)
    }
  }
  const sign = dir === "desc" ? -1 : 1
  return [...cards].sort((a, b) => sign * compare(a, b) || compareText(a.position, b.position))
}

interface Group {
  readonly key: string
  readonly label: string
  readonly tasks: TaskCard[]
}

/** Tasks belong to every group they match; unassigned and unlabelled tasks get their own group. */
const groupCards = (cards: ReadonlyArray<TaskCard>, groupBy: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    if (groupBy === "none") return [{ key: "all", label: "All tasks", tasks: [...cards] }]
    const groups = new Map<string, Group>()
    const add = (key: string, label: string, card: TaskCard) => {
      const group = groups.get(key) ?? { key, label, tasks: [] }
      group.tasks.push(card)
      groups.set(key, group)
    }
    if (groupBy === "column") {
      const ids = [...new Set(cards.map((card) => card.columnId))]
      const names = ids.length
        ? yield* db
            .select({ id: boardColumns.id, name: boardColumns.name })
            .from(boardColumns)
            .where(inArray(boardColumns.id, ids))
            .pipe(Effect.orDie)
        : []
      const nameOf = new Map(names.map((row) => [row.id, row.name]))
      for (const card of cards) add(card.columnId, nameOf.get(card.columnId) ?? "", card)
    } else if (groupBy === "priority") {
      for (const card of cards) add(card.priority, card.priority, card)
    } else if (groupBy === "assignee") {
      const ids = [...new Set(cards.flatMap((card) => card.assignees))]
      const names = ids.length
        ? yield* db
            .select({ userId: userProfiles.userId, name: userProfiles.displayName })
            .from(userProfiles)
            .where(inArray(userProfiles.userId, ids))
            .pipe(Effect.orDie)
        : []
      const nameOf = new Map(names.map((row) => [row.userId, row.name]))
      for (const card of cards) {
        if (card.assignees.length === 0) add("none", "Unassigned", card)
        for (const userId of card.assignees) add(userId, nameOf.get(userId) ?? "", card)
      }
    } else {
      const ids = [...new Set(cards.flatMap((card) => card.labels))]
      const names = ids.length
        ? yield* db
            .select({ id: labels.id, name: labels.name })
            .from(labels)
            .where(inArray(labels.id, ids))
            .pipe(Effect.orDie)
        : []
      const nameOf = new Map(names.map((row) => [row.id, row.name]))
      for (const card of cards) {
        if (card.labels.length === 0) add("none", "No label", card)
        for (const labelId of card.labels) add(labelId, nameOf.get(labelId) ?? "", card)
      }
    }
    return [...groups.values()]
  })

/** Board columns with their visible, filtered cards. WIP limits are warnings only. */
export const boardView = (boardId: BoardId, filter: TaskFilter) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireOn("board.read", boardId)
    const columns = yield* db
      .select({
        id: boardColumns.id,
        name: boardColumns.name,
        category: boardColumns.category,
        position: boardColumns.position,
        wipLimit: boardColumns.wipLimit,
      })
      .from(boardColumns)
      .where(eq(boardColumns.boardId, boardId))
      .orderBy(asc(sql`${boardColumns.position} collate "C"`))
      .pipe(Effect.orDie)
    const conditions = yield* filterConditions(filter)
    const cards = yield* toCards(yield* taskRows([eq(tasks.boardId, boardId), ...conditions]))
    const ordered = [...cards].sort((a, b) => compareText(a.position, b.position))
    return {
      boardId,
      columns: columns.map((column) => {
        const inColumn = ordered.filter((card) => card.columnId === column.id)
        return {
          id: column.id as ColumnId,
          name: column.name,
          category: column.category,
          position: column.position,
          wipLimit: column.wipLimit,
          overWipLimit: column.wipLimit !== null && inColumn.length > column.wipLimit,
          tasks: inColumn,
        }
      }),
    }
  })

export const listTasks = (projectId: ProjectId, query: ListTasksQuery) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("project.read", projectId)
    const conditions = yield* filterConditions(query)
    const cards = yield* toCards(yield* taskRows([eq(tasks.projectId, projectId), ...conditions]))
    const sorted = sortCards(cards, query.sort ?? "position", query.sortDir ?? "asc")
    return { groups: yield* groupCards(sorted, query.groupBy ?? "none") }
  })

/** Open tasks assigned to the caller across every project they can see. */
export const myTasks = () =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser("task.read")
    const assigned = db
      .select({ taskId: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.userId, userId))
    const cards = yield* toCards(
      yield* taskRows([inArray(tasks.id, assigned), isNull(tasks.completedAt)]),
    )
    return [...cards].sort(
      (a, b) => compareDates(a.dueAt, b.dueAt) || b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
  })

export const calendarItems = (projectId: ProjectId, query: CalendarQuery) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("project.read", projectId)
    const conditions = yield* filterConditions(query)
    const cards = yield* toCards(
      yield* taskRows([
        eq(tasks.projectId, projectId),
        gte(tasks.dueAt, new Date(query.from)),
        lt(tasks.dueAt, new Date(query.to)),
        ...conditions,
      ]),
    )
    return cards.flatMap((card) =>
      card.dueAt === null
        ? []
        : [
            {
              id: card.id,
              key: card.key,
              title: card.title,
              dueAt: card.dueAt,
              startAt: card.startAt,
              columnCategory: card.columnCategory,
              assignees: card.assignees,
            },
          ],
    )
  })

const relationTargets = (taskId: TaskId) =>
  Effect.gen(function* () {
    const db = yield* Db
    // The WHERE clause limits rows to the three task-to-task kinds; the cast names that subset.
    const kind = sql<RelationKind>`${references.kind}`
    const kinds = ["blocks", "relates", "duplicates"] as const
    const outgoing = yield* db
      .select({ kind, targetId: references.targetId })
      .from(references)
      .where(and(eq(references.sourceId, taskId), inArray(references.kind, [...kinds])))
      .pipe(Effect.orDie)
    const incoming = yield* db
      .select({ kind, targetId: references.sourceId })
      .from(references)
      .where(and(eq(references.targetId, taskId), inArray(references.kind, [...kinds])))
      .pipe(Effect.orDie)
    return [
      ...outgoing.map((row) => ({
        kind: row.kind,
        targetId: row.targetId as EntityId,
        direction: "outgoing" as const,
      })),
      ...incoming.map((row) => ({
        kind: row.kind,
        targetId: row.targetId as EntityId,
        direction: "incoming" as const,
      })),
    ]
  })

/**
 * Full task view for the detail panel. Relations to tasks the caller cannot see keep their kind and
 * direction but carry no key or title.
 */
export const taskDetail = (taskId: TaskId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    yield* authz.requireOn("task.read", taskId)
    const me = yield* currentUser("task.read")
    const [row] = yield* taskRows([eq(tasks.id, taskId)])
    if (!row) return yield* new NotFound({ entity: "task", id: taskId })
    const [card] = yield* toCards([row])
    if (!card) return yield* new NotFound({ entity: "task", id: taskId })

    const watcherRows = yield* db
      .select({ userId: watchers.userId })
      .from(watchers)
      .where(eq(watchers.entityId, taskId))
      .pipe(Effect.orDie)
    const watcherIds = watcherRows.map((row) => row.userId as UserId)

    const relations = yield* Effect.forEach(yield* relationTargets(taskId), (target) =>
      Effect.gen(function* () {
        const [other] = yield* taskRows([eq(tasks.id, target.targetId as TaskId)])
        return {
          kind: target.kind,
          direction: target.direction,
          targetId: target.targetId,
          key: other ? `${other.projectKey}-${other.number}` : null,
          title: other ? other.title : null,
          restricted: other === undefined,
        }
      }),
    )

    const commentRows = yield* db
      .select({
        id: comments.id,
        targetId: comments.targetId,
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
      .where(and(eq(comments.targetId, taskId), isNull(entities.deletedAt)))
      .orderBy(asc(entities.createdAt))
      .pipe(Effect.orDie)

    const activityRows = yield* db
      .select({
        id: trailEvents.id,
        action: trailEvents.action,
        actorId: trailEvents.actorId,
        at: trailEvents.at,
        diff: trailEvents.diff,
      })
      .from(trailEvents)
      .where(eq(trailEvents.entityId, taskId))
      .orderBy(desc(trailEvents.at))
      .limit(50)
      .pipe(Effect.orDie)

    const myRole = (yield* authz.roleOn(me, taskId)) ?? "viewer"

    const detail: TaskDetail = {
      ...card,
      description: row.description,
      creatorId: row.creatorId,
      watching: watcherIds.includes(me),
      watchers: watcherIds,
      relations,
      comments: commentRows.map((comment) => ({
        id: comment.id as CommentId,
        taskId: comment.targetId as TaskId,
        authorId: comment.authorId as UserId,
        body: comment.body as Record<string, unknown>,
        bodyText: comment.bodyText,
        anchor: comment.anchor as Record<string, unknown> | null,
        parentCommentId: comment.parentCommentId as CommentId | null,
        resolvedAt: comment.resolvedAt,
        editedAt: comment.editedAt,
        createdAt: comment.createdAt,
        version: comment.version,
      })),
      activity: activityRows.map((event) => ({
        id: String(event.id),
        action: event.action,
        actorId: (event.actorId as UserId | null) ?? null,
        createdAt: event.at,
        diff: event.diff,
      })),
      myRole,
    }
    return detail
  })

export const taskByNumber = (projectId: ProjectId, number: number) =>
  Effect.gen(function* () {
    const [row] = yield* taskRows([eq(tasks.projectId, projectId), eq(tasks.number, number)])
    if (!row) return yield* new NotFound({ entity: "task", id: `${number}` })
    return yield* taskDetail(row.id)
  })

export const subtasksOf = (taskId: TaskId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireOn("task.read", taskId)
    return yield* toCards(yield* taskRows([eq(entities.parentId, taskId)]))
  })

export const savedFiltersOf = (projectId: ProjectId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const userId = yield* currentUser("saved_filter.read")
    const rows = yield* db
      .select({
        id: savedFilters.id,
        projectId: savedFilters.projectId,
        name: savedFilters.name,
        filter: savedFilters.filter,
      })
      .from(savedFilters)
      .where(and(eq(savedFilters.userId, userId), eq(savedFilters.projectId, projectId)))
      .orderBy(asc(savedFilters.name))
      .pipe(Effect.orDie)
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(ListTasksQuery)(row.filter).pipe(
        Effect.map((filter): SavedFilter => ({
          id: row.id as EntityId,
          projectId: row.projectId as ProjectId | null,
          name: row.name,
          filter,
        })),
        Effect.orDie,
      ),
    )
  })
