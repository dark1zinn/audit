import { Trans } from "@lingui/react/macro"
import { useNavigate } from "@tanstack/react-router"
import { useQueries, useQuery } from "@tanstack/react-query"
import type { ProjectId } from "@audit/domain/ids"
import type { CalendarSummary } from "@audit/domain/calendar/schema"
import type { ListTasksQuery } from "@audit/domain/tasks/schema"
import { useMemo, useState } from "react"
import { useCalendarPrefs } from "../../lib/calendar-prefs.ts"
import {
  dueToDisplay,
  fromWall,
  occurrenceKey,
  occurrenceToDisplay,
  weekRange,
  type CalendarDisplayEvent,
} from "../../lib/calendar.ts"
import { useRealtimeScopes } from "../../lib/realtime.ts"
import {
  calendarEventsQuery,
  calendarQuery,
  calendarsQuery,
  projectsQuery,
} from "../../lib/queries.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { taskNumber } from "../list/task-rows.tsx"
import { filterOf, parseTaskSearch } from "../list/task-search.ts"
import { CalendarBoard } from "./calendar-board.tsx"
import { CalendarDialog, ImportDialog, type CalendarDialogTarget } from "./calendar-dialogs.tsx"
import { CalendarList } from "./calendar-list.tsx"
import { EventDialog, type EventDialogTarget } from "./event-dialog.tsx"

/** Pseudo calendar id for task due dates shown in the board. */
const TASKS_CALENDAR_ID = "tasks"

export type CalendarScope =
  | { readonly kind: "all" }
  | { readonly kind: "project"; readonly projectId: ProjectId }

interface TaskLink {
  readonly projectKey: string
  readonly number: string
}

/**
 * Calendar page body, used by `/calendar` (every calendar the user can see) and by the project
 * Calendar tab (only that project's calendars and due dates). Events come from the calendar API;
 * due dates come from each project's tasks calendar endpoint.
 */
export function CalendarWorkspace({
  scope,
  timezone,
  userId,
  filter,
}: {
  readonly scope: CalendarScope
  readonly timezone: string
  readonly userId: string
  readonly filter?: ListTasksQuery
}) {
  const navigate = useNavigate()
  const prefs = useCalendarPrefs()
  // Schedule-X does not report its first range, so start from the default week view.
  const [range, setRange] = useState<{ readonly from: string; readonly to: string } | null>(() => {
    const week = weekRange(new Date(), timezone)
    return { from: week.from.toISOString(), to: week.to.toISOString() }
  })
  const [eventTarget, setEventTarget] = useState<EventDialogTarget | null>(null)
  const [calendarTarget, setCalendarTarget] = useState<CalendarDialogTarget | null>(null)
  const [importing, setImporting] = useState<CalendarSummary | null>(null)

  const calendarsResult = useQuery(calendarsQuery)
  const allCalendars = useMemo(() => calendarsResult.data ?? [], [calendarsResult.data])
  const calendars = useMemo(
    () =>
      scope.kind === "all"
        ? allCalendars
        : allCalendars.filter((calendar) => calendar.projectId === scope.projectId),
    [allCalendars, scope],
  )

  const events = useQuery({
    ...calendarEventsQuery(range?.from ?? "", range?.to ?? ""),
    enabled: range !== null,
  })

  const projectsResult = useQuery(projectsQuery)
  const projects = useMemo(() => {
    const all = projectsResult.data ?? []
    return scope.kind === "all" ? all : all.filter((project) => project.id === scope.projectId)
  }, [projectsResult.data, scope])

  const taskQuery = { ...filterOf(filter ?? parseTaskSearch({})) }
  const dueQueries = useQueries({
    queries: projects.map((project) => ({
      ...calendarQuery(project.id, {
        ...taskQuery,
        from: range?.from ?? "",
        to: range?.to ?? "",
      }),
      enabled: prefs.showTasks && range !== null,
    })),
  })

  const occurrences = useMemo(() => events.data ?? [], [events.data])
  const occurrenceById = useMemo(
    () => new Map(occurrences.map((occurrence) => [occurrenceKey(occurrence), occurrence])),
    [occurrences],
  )

  // The dialog reads links and versions from the live occurrence, so refetches show up in it.
  const liveEventTarget = useMemo<EventDialogTarget | null>(() => {
    if (eventTarget?.kind !== "edit") return eventTarget
    const live = occurrenceById.get(occurrenceKey(eventTarget.occurrence))
    return live === undefined ? eventTarget : { kind: "edit", occurrence: live }
  }, [eventTarget, occurrenceById])

  const visibleCalendarIds = useMemo(
    () => new Set(calendars.map((calendar) => calendar.id).filter((id) => !prefs.hidden.has(id))),
    [calendars, prefs.hidden],
  )

  const taskLinks = useMemo(() => {
    const links = new Map<string, TaskLink>()
    projects.forEach((project, index) => {
      for (const item of dueQueries[index]?.data ?? []) {
        links.set(`task:${item.id}`, {
          projectKey: project.key,
          number: taskNumber(item.key),
        })
      }
    })
    return links
  }, [projects, dueQueries])

  const displayEvents = useMemo<ReadonlyArray<CalendarDisplayEvent>>(() => {
    const list: CalendarDisplayEvent[] = occurrences
      .filter((occurrence) => visibleCalendarIds.has(occurrence.calendarId))
      .map((occurrence) => occurrenceToDisplay(occurrence, timezone))
    if (prefs.showTasks) {
      projects.forEach((_project, index) => {
        for (const item of dueQueries[index]?.data ?? []) {
          list.push(dueToDisplay(item, timezone, TASKS_CALENDAR_ID))
        }
      })
    }
    return list
  }, [occurrences, visibleCalendarIds, timezone, prefs.showTasks, projects, dueQueries])

  useRealtimeScopes(calendars.map((calendar) => `entity:${calendar.id}`))

  const boardCalendars = useMemo(
    () => [
      ...calendars.map((calendar) => ({ id: calendar.id, color: calendar.color })),
      { id: TASKS_CALENDAR_ID, color: "#64748b" },
    ],
    [calendars],
  )

  const defaultCalendarId =
    calendars.find((calendar) => !prefs.hidden.has(calendar.id))?.id ?? calendars[0]?.id ?? null

  const openEvent = (id: string) => {
    const link = taskLinks.get(id)
    if (link !== undefined) {
      void navigate({
        to: "/p/$key/t/$number",
        params: { key: link.projectKey, number: link.number },
      })
      return
    }
    const occurrence = occurrenceById.get(id)
    if (occurrence !== undefined) setEventTarget({ kind: "edit", occurrence })
  }

  const createAt = (start: Date, allDay: boolean) =>
    setEventTarget({ kind: "create", start, allDay })

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <CalendarList
        calendars={calendars}
        hidden={prefs.hidden}
        showTasks={prefs.showTasks}
        onVisibleChange={prefs.setCalendarVisible}
        onShowTasksChange={prefs.setShowTasks}
        onNew={() =>
          setCalendarTarget(
            scope.kind === "project"
              ? { kind: "create", projectId: scope.projectId }
              : { kind: "create" },
          )
        }
        onEdit={(calendar) => setCalendarTarget({ kind: "edit", calendar })}
        onImport={setImporting}
      />

      <div className="grid gap-3">
        {calendarsResult.isError && <ErrorMessage error={calendarsResult.error} />}
        {events.isError && <ErrorMessage error={events.error} />}
        {events.isPending && range !== null && <LoadingRows rows={1} />}
        {calendars.length === 0 && calendarsResult.isSuccess && (
          <p className="text-sm text-muted-foreground">
            <Trans>No calendars yet. Create one to start adding events.</Trans>
          </p>
        )}
        <CalendarBoard
          timezone={timezone}
          calendars={boardCalendars}
          events={displayEvents}
          onRangeChange={(next) =>
            setRange((prev) => {
              const from = next.from.toISOString()
              const to = next.to.toISOString()
              return prev?.from === from && prev.to === to ? prev : { from, to }
            })
          }
          onEventClick={openEvent}
          onSlotClick={(slot) => {
            if ("epochMilliseconds" in slot) {
              createAt(new Date(slot.epochMilliseconds), false)
              return
            }
            const start = fromWall(slot.toString(), "09:00", timezone)
            if (start !== undefined) createAt(start, true)
          }}
        />
      </div>

      <EventDialog
        target={liveEventTarget}
        viewerTimezone={timezone}
        userId={userId}
        calendars={calendars}
        defaultCalendarId={defaultCalendarId}
        onOpenChange={(open) => {
          if (!open) setEventTarget(null)
        }}
      />
      <CalendarDialog
        target={calendarTarget}
        onOpenChange={(open) => {
          if (!open) setCalendarTarget(null)
        }}
      />
      <ImportDialog
        calendar={importing}
        onOpenChange={(open) => {
          if (!open) setImporting(null)
        }}
      />
    </div>
  )
}
