import "temporal-polyfill/global"
import "@schedule-x/theme-default/dist/index.css"
import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { viewMonthGrid } from "@schedule-x/calendar"
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { taskNumber } from "../list/task-rows.tsx"
import { filterOf } from "../list/task-search.ts"
import type { ProjectId } from "@audit/domain/ids"
import type { CalendarItem, ListTasksQuery } from "@audit/domain/tasks/schema"
import { calendarQuery } from "../../lib/queries.ts"

/**
 * Month view of tasks by due date. Tasks are all-day events in the user's time zone; clicking one
 * opens its task panel. The visible range drives the query, so navigating months fetches the new range.
 */
export function ProjectCalendar({
  projectId,
  projectKey,
  timezone,
  filter,
}: {
  readonly projectId: ProjectId
  readonly projectKey: string
  readonly timezone: string
  readonly filter: ListTasksQuery
}) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const [range, setRange] = useState<{ readonly from: string; readonly to: string } | null>(null)
  const itemsRef = useRef<ReadonlyMap<string | number, CalendarItem>>(new Map())

  const calendarApp = useCalendarApp({
    views: [viewMonthGrid],
    selectedDate: Temporal.Now.plainDateISO(timezone),
    timezone,
    locale: i18n.locale,
    isDark: document.documentElement.classList.contains("dark"),
    events: [],
    callbacks: {
      onRangeUpdate: (visible) =>
        setRange({
          from: visible.start.toInstant().toString(),
          to: visible.end.toInstant().toString(),
        }),
      onEventClick: (event) => {
        const item = itemsRef.current.get(event.id)
        if (item === undefined) return
        void navigate({
          to: "/p/$key/t/$number",
          params: { key: projectKey, number: taskNumber(item.key) },
        })
      },
    },
  })

  const calendar = useQuery({
    ...calendarQuery(projectId, {
      ...filterOf(filter),
      from: range?.from ?? "",
      to: range?.to ?? "",
    }),
    enabled: range !== null,
  })

  const items = useMemo(() => calendar.data ?? [], [calendar.data])
  useEffect(() => {
    itemsRef.current = new Map(items.map((item) => [item.id, item]))
  }, [items])

  const events = useMemo(
    () =>
      items.map((item) => {
        const day = Temporal.Instant.fromEpochMilliseconds(item.dueAt.getTime())
          .toZonedDateTimeISO(timezone)
          .toPlainDate()
        return { id: item.id, title: `${item.key} ${item.title}`, start: day, end: day }
      }),
    [items, timezone],
  )

  useEffect(() => {
    calendarApp?.events.set(events)
  }, [calendarApp, events])

  return (
    <div className="space-y-3">
      {calendar.isPending && range !== null && <LoadingRows rows={1} />}
      {calendar.isError && <ErrorMessage error={calendar.error} />}
      <div className="min-h-[600px]">
        {calendarApp !== null && <ScheduleXCalendar calendarApp={calendarApp} />}
      </div>
    </div>
  )
}
