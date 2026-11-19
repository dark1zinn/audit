/**
 * Rewrites a board's column and task position keys into short, evenly spaced keys. Keys grow when
 * items are repeatedly placed between the same neighbours; this keeps them under the length limit.
 * Relative order never changes.
 */
import { boardColumns, boards, entities, tasks } from "@audit/db/schema"
import { BoardId } from "@audit/domain/ids"
import { initialKeys } from "@audit/domain/ordering"
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { record } from "../trail.ts"

export const boardRebalance = defineJob("board.rebalance", Schema.Struct({ boardId: BoardId }))

/** Rebalances every board. Enqueued on demand from the admin maintenance page. */
export const boardsRebalanceJob = defineJob("boards.rebalance", Schema.Struct({}))

/** Assigns fresh keys to every column and to every live task of `boardId`, in current order. */
export const rebalanceBoard = (boardId: BoardId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const columns = yield* db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.boardId, boardId))
      .orderBy(asc(sql`${boardColumns.position} collate "C"`))
      .pipe(Effect.orDie)
    const columnKeys = initialKeys(columns.length)
    for (const [index, column] of columns.entries()) {
      yield* db
        .update(boardColumns)
        .set({ position: columnKeys[index]! })
        .where(eq(boardColumns.id, column.id))
        .pipe(Effect.orDie)
    }

    const items = yield* db
      .select({ id: tasks.id, columnId: tasks.columnId })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .where(and(eq(tasks.boardId, boardId), isNull(entities.deletedAt)))
      .orderBy(asc(tasks.columnId), asc(sql`${tasks.position} collate "C"`))
      .pipe(Effect.orDie)
    const byColumn = new Map<string, string[]>()
    for (const item of items) {
      const group = byColumn.get(item.columnId) ?? []
      group.push(item.id)
      byColumn.set(item.columnId, group)
    }
    for (const ids of byColumn.values()) {
      const keys = initialKeys(ids.length)
      for (const [index, id] of ids.entries()) {
        yield* db
          .update(tasks)
          .set({ position: keys[index]! })
          .where(eq(tasks.id, id as typeof tasks.$inferSelect.id))
          .pipe(Effect.orDie)
      }
    }
  })

/** Rebalances every board in one pass; the job runs it as the system actor. */
export const rebalanceAllBoards = Command.make("boards.rebalance", {
  input: Schema.Struct({}),
  output: Schema.Struct({ count: Schema.Number }),
  authorize: () =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireCapability("workspace.settings")
    }),
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const all = yield* db.select({ id: boards.id }).from(boards).pipe(Effect.orDie)
      for (const { id } of all) yield* rebalanceBoard(id as BoardId)
      const result = { count: all.length }
      yield* record({ action: "board.rebalanced_all", details: result })
      return result
    }),
})
