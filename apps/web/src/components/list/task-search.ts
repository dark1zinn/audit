import { Result, Schema } from "effect"
import { ListTasksQuery, TaskFilter } from "@audit/domain/tasks/schema"

/** Keys that hold plain strings; TanStack's default search parser turns "123" into a number. */
const STRING_KEYS = ["assigneeId", "labelId", "dueAfter", "dueBefore", "text"] as const

/**
 * Normalizes raw URL search params into a `ListTasksQuery`. Empty values are dropped and any
 * shape that fails validation falls back to no filters, so a hand-edited URL never breaks the page.
 */
export function parseTaskSearch(search: Record<string, unknown>): ListTasksQuery {
  const normalized: Record<string, unknown> = {}
  for (const key of STRING_KEYS) {
    const value = search[key]
    const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : ""
    if (text.trim() !== "") normalized[key] = text.trim()
  }
  for (const key of ["priority", "category", "sort", "sortDir", "groupBy"] as const) {
    const value = search[key]
    if (typeof value === "string" && value !== "") normalized[key] = value
  }
  if (search.mentionsMe === true || search.mentionsMe === "true") normalized.mentionsMe = true
  const decoded = Schema.decodeUnknownResult(ListTasksQuery)(normalized)
  return Result.isSuccess(decoded) ? decoded.success : {}
}

/** Merges a patch into the current search; `undefined` removes a key. */
export function withTaskSearch(
  current: ListTasksQuery,
  patch: Partial<Record<keyof ListTasksQuery, unknown>>,
): ListTasksQuery {
  return parseTaskSearch({ ...current, ...patch })
}

/** Number of filter fields in use (sort and grouping are not filters). */
export function countActiveFilters(query: ListTasksQuery): number {
  return [
    query.assigneeId,
    query.labelId,
    query.priority,
    query.category,
    query.dueAfter,
    query.dueBefore,
    query.text,
    query.mentionsMe,
  ].filter((value) => value !== undefined).length
}

/** The filter part of a query (no sort or grouping), e.g. for the calendar endpoint. */
export function filterOf(query: ListTasksQuery): TaskFilter {
  const decoded = Schema.decodeUnknownResult(TaskFilter)(query)
  return Result.isSuccess(decoded) ? decoded.success : {}
}
