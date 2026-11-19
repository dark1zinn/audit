import { useSyncExternalStore } from "react"

/**
 * Per-browser calendar view preferences: which calendars are hidden and whether the task due
 * overlay is shown. Persisted in localStorage so they survive reloads.
 */
const HIDDEN_KEY = "audit.calendar.hidden"
const TASKS_KEY = "audit.calendar.tasks"

interface Prefs {
  readonly hidden: ReadonlySet<string>
  readonly showTasks: boolean
}

const read = (): Prefs => {
  let hidden: ReadonlySet<string> = new Set()
  let showTasks = true
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    if (Array.isArray(parsed)) {
      hidden = new Set(parsed.filter((id): id is string => typeof id === "string"))
    }
    showTasks = localStorage.getItem(TASKS_KEY) !== "false"
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return { hidden, showTasks }
}

let current: Prefs = read()
const listeners = new Set<() => void>()

const write = (next: Prefs) => {
  current = next
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next.hidden]))
    localStorage.setItem(TASKS_KEY, String(next.showTasks))
  } catch {
    // Storage full or blocked: the preference still applies for this session.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useCalendarPrefs = (): Prefs & {
  readonly setCalendarVisible: (calendarId: string, visible: boolean) => void
  readonly setShowTasks: (show: boolean) => void
} => {
  const prefs = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  )
  return {
    ...prefs,
    setCalendarVisible: (calendarId, visible) => {
      const hidden = new Set(current.hidden)
      if (visible) hidden.delete(calendarId)
      else hidden.add(calendarId)
      write({ ...current, hidden })
    },
    setShowTasks: (show) => write({ ...current, showTasks: show }),
  }
}
