import { Option, Schema } from "effect"
import { keyBetween } from "@audit/domain/ordering"
import type { ColumnId, TaskId } from "@audit/domain/ids"
import type { ColumnCategory } from "@audit/domain/projects/schema"
import type { BoardView, TaskCard } from "@audit/domain/tasks/schema"
import { ListTasksQuery } from "@audit/domain/tasks/schema"

/** columnId -> ordered task ids. Used for drag previews; derived from the board view. */
export type Lanes = Readonly<Record<string, ReadonlyArray<string>>>

export interface MoveRequest {
  readonly taskId: TaskId
  readonly columnId: ColumnId
  readonly afterTaskId: TaskId | null
  readonly position: string
  readonly version: number
  readonly columnCategory: ColumnCategory
}

const byPosition = (a: TaskCard, b: TaskCard) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0

const COLUMN_DROP_PREFIX = "column:"
export const columnDropId = (columnId: string) => `${COLUMN_DROP_PREFIX}${columnId}`
export const isColumnDrop = (id: string | number) => String(id).startsWith(COLUMN_DROP_PREFIX)
export const columnFromDrop = (id: string | number) => String(id).slice(COLUMN_DROP_PREFIX.length)

export const cardDomId = (taskId: string) => `board-card-${taskId}`

export const taskNumber = (key: string) => key.slice(key.lastIndexOf("-") + 1)

export const lanesOf = (view: BoardView): Lanes =>
  Object.fromEntries(
    view.columns.map((column) => [
      column.id,
      [...column.tasks].sort(byPosition).map((task) => task.id),
    ]),
  )

export const findTask = (view: BoardView, taskId: string): TaskCard | undefined => {
  for (const column of view.columns) {
    const task = column.tasks.find((candidate) => candidate.id === taskId)
    if (task !== undefined) return task
  }
  return undefined
}

export const locate = (lanes: Lanes, taskId: string): string | undefined =>
  Object.keys(lanes).find((columnId) => lanes[columnId]?.includes(taskId))

/** Moves a task into `toColumn`, before `overTaskId` (or at the end when null). */
export const moveInLanes = (
  lanes: Lanes,
  taskId: string,
  toColumn: string,
  overTaskId: string | null,
): Lanes => {
  const fromColumn = locate(lanes, taskId)
  if (fromColumn === undefined) return lanes
  const without = {
    ...lanes,
    [fromColumn]: (lanes[fromColumn] ?? []).filter((id) => id !== taskId),
  }
  const target = without[toColumn] ?? []
  const found = overTaskId === null ? -1 : target.indexOf(overTaskId)
  const index = found < 0 ? target.length : found
  return {
    ...without,
    [toColumn]: [...target.slice(0, index), taskId, ...target.slice(index)],
  }
}

/** Plans a move of `taskId` to its position inside `lanes[toColumn]` (already final order). */
export const planMove = (
  view: BoardView,
  lanes: Lanes,
  taskId: string,
  toColumn: string,
): MoveRequest | undefined => {
  const task = findTask(view, taskId)
  const column = view.columns.find((candidate) => candidate.id === toColumn)
  const list = lanes[toColumn]
  if (task === undefined || column === undefined || list === undefined) return undefined
  const index = list.indexOf(taskId)
  if (index < 0) return undefined
  const prevId = index > 0 ? list[index - 1] : undefined
  const nextId = index < list.length - 1 ? list[index + 1] : undefined
  const before = prevId === undefined ? null : (findTask(view, prevId)?.position ?? null)
  const after = nextId === undefined ? null : (findTask(view, nextId)?.position ?? null)
  return {
    taskId: task.id,
    columnId: column.id,
    afterTaskId: prevId === undefined ? null : (prevId as TaskId),
    position: keyBetween(before, after),
    version: task.version,
    columnCategory: column.category,
  }
}

/** Replaces (or inserts) a card in its target column and recomputes WIP flags. */
export const placeCard = (view: BoardView, card: TaskCard): BoardView => ({
  ...view,
  columns: view.columns.map((column) => {
    const others = column.tasks.filter((task) => task.id !== card.id)
    const tasks = column.id === card.columnId ? [...others, card].sort(byPosition) : others
    const overWipLimit = column.wipLimit !== null && tasks.length > column.wipLimit
    return { ...column, tasks, overWipLimit }
  }),
})

export const optimisticMove = (view: BoardView, request: MoveRequest): BoardView => {
  const task = findTask(view, request.taskId)
  if (task === undefined) return view
  return placeCard(view, {
    ...task,
    columnId: request.columnId,
    columnCategory: request.columnCategory,
    position: request.position,
  })
}

const decodeQuery = Schema.decodeUnknownOption(ListTasksQuery)

/** Search params for the board route: invalid input resets to no filters. */
export const validateBoardSearch = (search: Record<string, unknown>): ListTasksQuery =>
  Option.getOrElse(decodeQuery(search), (): ListTasksQuery => ({}))

/** Filter changes; `undefined`, `""` or `false` clear a field. */
export type FilterPatch = { readonly [K in keyof ListTasksQuery]?: string | boolean | undefined }

/** Merges a patch into a query, dropping empty values so the URL stays clean. */
export const patchQuery = (query: ListTasksQuery, patch: FilterPatch): ListTasksQuery =>
  Object.fromEntries(
    Object.entries({ ...query, ...patch }).filter(
      ([, value]) => value !== undefined && value !== "" && value !== false,
    ),
  ) as ListTasksQuery
