import { useEffect, useRef, useState } from "react"
import { Temporal } from "temporal-polyfill"
import { useLingui } from "@lingui/react/macro"
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react"
import {
  createViewDay,
  createViewMonthAgenda,
  createViewMonthGrid,
  createViewWeek,
} from "@schedule-x/calendar"
import "@schedule-x/theme-default/dist/index.css"
import { useTheme } from "@audit/ui/theme.tsx"
import type { CalendarDisplayEvent } from "../../lib/calendar.ts"
import type { EntityTarget } from "../actions/types.ts"
import { calendarColorSets, tasksColorSets } from "./calendar-theme.ts"
import { DateGridEventSlot, EventTargetContext, TimeGridEventSlot } from "./calendar-event.tsx"

export interface BoardCalendar {
  readonly id: string
  readonly color: string
}

export interface BoardRange {
  readonly from: Date
  readonly to: Date
}

interface BoardProps {
  readonly timezone: string
  readonly calendars: ReadonlyArray<BoardCalendar>
  readonly events: ReadonlyArray<CalendarDisplayEvent>
  readonly onRangeChange: (range: BoardRange) => void
  readonly onEventClick: (id: string) => void
  readonly onSlotClick: (start: Temporal.ZonedDateTime | Temporal.PlainDate) => void
  readonly eventTargetFor: (id: string) => EntityTarget | undefined
  readonly initialDate?: string | undefined
}

/** Schedule-X needs full BCP-47 tags; Lingui uses bare language codes. */
const SCHEDULE_LOCALES: Readonly<Record<string, string>> = {
  en: "en-US",
  "pt-BR": "pt-BR",
  es: "es-ES",
}

/**
 * Slot components must be stable: Schedule-X registers them when the app is set up, so an inline
 * object would re-register on every render.
 */
const CUSTOM_COMPONENTS = {
  timeGridEvent: TimeGridEventSlot,
  dateGridEvent: DateGridEventSlot,
}

/** The day the board opens on, from a `YYYY-MM-DD` search param; undefined when absent or invalid. */
function selectedDateFrom(value: string | undefined): Temporal.PlainDate | undefined {
  if (value === undefined) return undefined
  try {
    return Temporal.PlainDate.from(value)
  } catch {
    return undefined
  }
}

/**
 * Schedule-X board. Its configuration is read once at creation, so the inner board is keyed by
 * timezone, locale and calendar colours: changing any of them remounts it. Event data is pushed
 * with `events.set`, so visibility toggles never remount the board. Theme changes do not remount:
 * they go through `setTheme`, and colours are CSS references resolved at paint time.
 */
export function CalendarBoard(props: BoardProps) {
  const { i18n } = useLingui()
  const colorKey = props.calendars.map((calendar) => `${calendar.id}:${calendar.color}`).join(",")
  return (
    <CalendarBoardInner
      key={`${props.timezone}|${i18n.locale}|${colorKey}|${props.initialDate ?? ""}`}
      {...props}
      locale={SCHEDULE_LOCALES[i18n.locale] ?? "en-US"}
    />
  )
}

function CalendarBoardInner({
  timezone,
  locale,
  calendars,
  events,
  onRangeChange,
  onEventClick,
  onSlotClick,
  eventTargetFor,
  initialDate,
}: BoardProps & { readonly locale: string }) {
  const { resolvedTheme } = useTheme()
  const selected = selectedDateFrom(initialDate)
  // Seven week columns do not fit below lg: open on Day there. Read once so a resize never flips the view.
  const [defaultView] = useState<"day" | "week">(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "week" : "day",
  )

  // Schedule-X keeps the callbacks it was created with: route them through a ref.
  const handlers = useRef({ onRangeChange, onEventClick, onSlotClick })
  useEffect(() => {
    handlers.current = { onRangeChange, onEventClick, onSlotClick }
  })

  const calendarConfig = Object.fromEntries([
    ...calendars.map((calendar) => [
      calendar.id,
      { colorName: calendar.id, ...calendarColorSets(calendar.color) },
    ]),
    ["tasks", { colorName: "tasks", ...tasksColorSets() }],
  ])

  const calendarApp = useCalendarApp({
    locale,
    timezone,
    calendars: calendarConfig,
    isDark: resolvedTheme === "dark",
    views: [createViewMonthGrid(), createViewWeek(), createViewDay(), createViewMonthAgenda()],
    defaultView,
    events: [],
    ...(selected === undefined ? {} : { selectedDate: selected }),
    callbacks: {
      onRangeUpdate(range) {
        handlers.current.onRangeChange({
          from: new Date(range.start.toInstant().epochMilliseconds),
          to: new Date(range.end.toInstant().epochMilliseconds),
        })
      },
      onEventClick(event) {
        handlers.current.onEventClick(String(event.id))
      },
      onClickDate(date) {
        handlers.current.onSlotClick(date)
      },
      onClickDateTime(dateTime) {
        handlers.current.onSlotClick(dateTime)
      },
    },
  })

  useEffect(() => {
    calendarApp?.setTheme(resolvedTheme)
  }, [calendarApp, resolvedTheme])

  useEffect(() => {
    calendarApp?.events.set([...events])
  }, [calendarApp, events])

  const { t } = useLingui()
  // Schedule-X sets aria-label on role-less day grids and on the view picker, where it conflicts with axe rules; strip them.
  // Its date picker input has no accessible name, so label it. Re-applied on each DOM change because the library re-creates the grid on view changes.
  const boardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = boardRef.current
    if (root === null) return
    const strip = () => {
      for (const el of root.querySelectorAll(
        ".sx__date-grid[aria-label], [data-time-grid-date][aria-label], .sx__view-selection-selected-item[aria-label]",
      )) {
        el.removeAttribute("aria-label")
      }
      for (const input of root.querySelectorAll(".sx__date-input:not([aria-label])")) {
        input.setAttribute("aria-label", t`Choose date`)
      }
    }
    strip()
    const observer = new MutationObserver(strip)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [t])

  // The all-day strip is capped in height; flag it while it hides rows so CSS can draw a fade.
  useEffect(() => {
    const root = boardRef.current
    if (root === null) return
    const mark = () => {
      for (const grid of root.querySelectorAll<HTMLElement>(".sx__date-grid")) {
        grid.toggleAttribute("data-overflowing", grid.scrollHeight > grid.clientHeight + 1)
      }
    }
    mark()
    const observer = new MutationObserver(mark)
    observer.observe(root, { childList: true, subtree: true })
    window.addEventListener("resize", mark)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", mark)
    }
  }, [])

  return (
    <EventTargetContext.Provider value={eventTargetFor}>
      <div ref={boardRef} className="min-w-0 max-w-full overflow-x-auto">
        <ScheduleXCalendar calendarApp={calendarApp} customComponents={CUSTOM_COMPONENTS} />
      </div>
    </EventTargetContext.Provider>
  )
}
