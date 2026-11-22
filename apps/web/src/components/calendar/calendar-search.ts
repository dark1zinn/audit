/** Search params shared by the calendar routes. `new` opens the create dialog; `event` deep-links an event; `date` (YYYY-MM-DD) selects the day it is shown on. */
export interface CalendarSearch {
  readonly new?: string | undefined
  readonly event?: string | undefined
  readonly date?: string | undefined
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Keeps only the calendar params that are well-formed; anything else is dropped. */
export function parseCalendarSearch(search: Record<string, unknown>): CalendarSearch {
  const result: { new?: string; event?: string; date?: string } = {}
  const created = search["new"]
  if (typeof created === "string") result.new = created
  const event = search["event"]
  if (typeof event === "string" && event !== "") result.event = event
  const date = search["date"]
  if (typeof date === "string" && DATE_PATTERN.test(date)) result.date = date
  return result
}
