import { tint } from "../../lib/calendar.ts"

/** Text colour for every event: the app foreground, so it follows the theme. */
export const EVENT_FOREGROUND = "var(--foreground)"

/** Colour of the task due-date pseudo calendar: the app's muted text colour. */
export const TASKS_COLOR = "var(--muted-foreground)"

interface CalendarColorSet {
  readonly main: string
  readonly container: string
  readonly onContainer: string
}

/**
 * Schedule-X colour sets for one calendar. Colours are CSS references, not resolved values, so
 * the browser resolves them against the active theme and a theme switch needs no re-read.
 * Dark containers are more opaque so events keep their contrast on a dark grid.
 */
export const calendarColorSets = (
  color: string,
): { readonly lightColors: CalendarColorSet; readonly darkColors: CalendarColorSet } => ({
  lightColors: { main: color, container: tint(color, "33"), onContainer: EVENT_FOREGROUND },
  darkColors: { main: color, container: tint(color, "55"), onContainer: EVENT_FOREGROUND },
})

/** Colour sets for the task due-date calendar, derived from the muted text token. */
export const tasksColorSets = (): {
  readonly lightColors: CalendarColorSet
  readonly darkColors: CalendarColorSet
} => ({
  lightColors: {
    main: TASKS_COLOR,
    container: `color-mix(in oklab, ${TASKS_COLOR} 22%, transparent)`,
    onContainer: EVENT_FOREGROUND,
  },
  darkColors: {
    main: TASKS_COLOR,
    container: `color-mix(in oklab, ${TASKS_COLOR} 34%, transparent)`,
    onContainer: EVENT_FOREGROUND,
  },
})
