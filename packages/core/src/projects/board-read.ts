/** Board loading shared by commands and queries. Authorization is the caller's job. */
import { boardColumns, boards, entities, tasks } from "@audit/db/schema"
import { NotFound } from "@audit/domain/errors"
import type { BoardId, ColumnId, ProjectId } from "@audit/domain/ids"
import type { Board, BoardColumn } from "@audit/domain/projects/schema"
import { Db } from "@audit/platform/database"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

/** A board row including soft-deleted boards is never returned; deleted boards are NotFound. */
export const boardRow = (boardId: BoardId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        id: boards.id,
        projectId: boards.projectId,
        name: boards.name,
        position: boards.position,
        restricted: entities.restricted,
        version: entities.version,
        deletedAt: entities.deletedAt,
      })
      .from(boards)
      .innerJoin(entities, eq(entities.id, boards.id))
      .where(eq(boards.id, boardId))
      .pipe(Effect.orDie)
    if (row === undefined || row.deletedAt !== null) {
      return yield* new NotFound({ entity: "board", id: boardId })
    }
    // The row boundary: uuid columns come back as plain strings; brand them once here.
    return { ...row, id: row.id as BoardId, projectId: row.projectId as ProjectId }
  })

/** Columns of a board in position order, with live task counts. */
export const boardColumnsWithCounts = (boardId: BoardId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const columns = yield* db
      .select({
        id: boardColumns.id,
        boardId: boardColumns.boardId,
        name: boardColumns.name,
        category: boardColumns.category,
        position: boardColumns.position,
        wipLimit: boardColumns.wipLimit,
      })
      .from(boardColumns)
      .where(eq(boardColumns.boardId, boardId))
      .orderBy(asc(sql`${boardColumns.position} collate "C"`))
      .pipe(Effect.orDie)
    const counts = yield* db
      .select({ columnId: tasks.columnId, count: sql<number>`count(*)::int` })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .where(and(eq(tasks.boardId, boardId), isNull(entities.deletedAt)))
      .groupBy(tasks.columnId)
      .pipe(Effect.orDie)
    const countByColumn = new Map(counts.map((row) => [row.columnId, row.count]))
    return columns.map((column): BoardColumn => ({
      id: column.id as ColumnId,
      boardId: column.boardId as BoardId,
      name: column.name,
      category: column.category,
      position: column.position,
      wipLimit: column.wipLimit,
      taskCount: countByColumn.get(column.id) ?? 0,
    }))
  })

export const loadBoard = (boardId: BoardId) =>
  Effect.gen(function* () {
    const row = yield* boardRow(boardId)
    const columns = yield* boardColumnsWithCounts(boardId)
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      position: row.position,
      restricted: row.restricted,
      version: row.version,
      columns,
    } satisfies Board
  })
