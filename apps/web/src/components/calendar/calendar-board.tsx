import { useEffect, useRef } from "react"
import type { Temporal } from "temporal-polyfill"
import { useLingui } from "@lingui/react/macro"
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react"
import {
  createViewDay,
  createViewMonthAgenda,
  createViewMonthGrid,
  createViewWeek,
} from "@schedule-x/calendar"
import "@schedule-x/theme-default/dist/index.css"
import type { CalendarDisplayEvent } from "../../lib/calendar.ts"
import { tint } from "../../lib/calendar.ts"

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
}

const TASKS_COLOR = "#64748b"

const colorsFor = (color: string) => ({
  lightColors: { main: color, container: tint(color, "33"), onContainer: "#1a1a1a" },
  darkColors: { main: color, container: tint(color, "55"), onContainer: "#f5f5f5" },
})

/** Schedule-X needs full BCP-47 tags; Lingui uses bare language codes. */
const SCHEDULE_LOCALES: Readonly<Record<string, string>> = {
  en: "en-US",
  "pt-BR": "pt-BR",
  es: "es-ES",
}

/**
 * Schedule-X board. Its configuration is read once at creation, so the inner board is keyed by
 * timezone, locale and calendar colours: changing any of them remounts it. Event data is pushed
 * with `events.set`, so visibility toggles never remount the board.
 */
export function CalendarBoard(props: BoardProps) {
  const { i18n } = useLingui()
  const colorKey = props.calendars.map((calendar) => `${calendar.id}:${calendar.color}`).join(",")
  return (
    <CalendarBoardInner
      key={`${props.timezone}|${i18n.locale}|${colorKey}`}
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
}: BoardProps & { readonly locale: string }) {
  // Schedule-X keeps the callbacks it was created with: route them through a ref.
  const handlers = useRef({ onRangeChange, onEventClick, onSlotClick })
  useEffect(() => {
    handlers.current = { onRangeChange, onEventClick, onSlotClick }
  })

  const calendarConfig = Object.fromEntries(
    [...calendars, { id: "tasks", color: TASKS_COLOR }].map((calendar) => [
      calendar.id,
      { colorName: calendar.id, ...colorsFor(calendar.color) },
    ]),
  )

  const calendarApp = useCalendarApp({
    locale,
    timezone,
    calendars: calendarConfig,
    views: [createViewMonthGrid(), createViewWeek(), createViewDay(), createViewMonthAgenda()],
    defaultView: "week",
    events: [],
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
    calendarApp?.events.set([...events])
  }, [calendarApp, events])

  return <ScheduleXCalendar calendarApp={calendarApp} />
}
