import { Trans, useLingui } from "@lingui/react/macro"
import { useNavigate } from "@tanstack/react-router"
import { useQueries, useQuery } from "@tanstack/react-query"
import { CalendarDays, PanelLeft } from "lucide-react"
import { toast } from "sonner"
import type { ProjectId } from "@audit/domain/ids"
import type { CalendarSummary } from "@audit/domain/calendar/schema"
import type { ListTasksQuery } from "@audit/domain/tasks/schema"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
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
import { EmptyState, ErrorMessage, LoadingRows } from "../feedback.tsx"
import { taskNumber } from "../list/task-rows.tsx"
import { taskHref } from "../../lib/entity-links.ts"
import { filterOf, parseTaskSearch } from "../list/task-search.ts"
import { CalendarBoard } from "./calendar-board.tsx"
import { CalendarDialog, ImportDialog, type CalendarDialogTarget } from "./calendar-dialogs.tsx"
import { CalendarList } from "./calendar-list.tsx"
import { EventDialog, type EventDialogTarget } from "./event-dialog.tsx"
import type { EntityTarget } from "../actions/types.ts"

/** Pseudo calendar id for task due dates shown in the board. */
const TASKS_CALENDAR_ID = "tasks"

/** Half-width of the fallback window searched when `?event=` is outside the visible range. */
const DEEP_LINK_WINDOW_MS = 45 * 24 * 60 * 60 * 1000

/** localStorage key for the calendars column (`open` or `closed`). */
const LIST_STORAGE_KEY = "audit.calendar.list"

export type CalendarScope =
  | { readonly kind: "all" }
  | { readonly kind: "project"; readonly projectId: ProjectId }

interface TaskLink {
  readonly projectKey: string
  readonly number: string
}

/** The date the board centres on: the `date` param at noon wall time, else today. */
function anchorDate(dateParam: string | undefined, timezone: string): Date {
  if (dateParam === undefined) return new Date()
  return fromWall(dateParam, "12:00", timezone) ?? new Date()
}

/** Column open state: the stored choice, else open only on very wide screens. */
function readListOpen(): boolean {
  const stored = localStorage.getItem(LIST_STORAGE_KEY)
  if (stored === "open") return true
  if (stored === "closed") return false
  return window.matchMedia("(min-width: 1536px)").matches
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
  newRequest,
  eventParam,
  dateParam,
  onEventParamDone,
}: {
  readonly scope: CalendarScope
  readonly timezone: string
  readonly userId: string
  readonly filter?: ListTasksQuery
  readonly newRequest?: string | undefined
  readonly eventParam?: string | undefined
  readonly dateParam?: string | undefined
  readonly onEventParamDone?: (() => void) | undefined
}) {
  const navigate = useNavigate()
  const { t } = useLingui()
  const prefs = useCalendarPrefs()
  // Schedule-X does not report its first range, so start from the week of the anchor date.
  const [range, setRange] = useState<{ readonly from: string; readonly to: string } | null>(() => {
    const week = weekRange(anchorDate(dateParam, timezone), timezone)
    return { from: week.from.toISOString(), to: week.to.toISOString() }
  })
  const [eventTarget, setEventTarget] = useState<EventDialogTarget | null>(() =>
    newRequest === undefined ? null : { kind: "create", start: new Date(), allDay: false },
  )
  // The deep-linked event the user closed; kept until the `event` param is cleared from the URL.
  const [dismissedParam, setDismissedParam] = useState<string | null>(null)
  const [calendarTarget, setCalendarTarget] = useState<CalendarDialogTarget | null>(null)
  const [importing, setImporting] = useState<CalendarSummary | null>(null)
  const [listOpen, setListOpen] = useState(readListOpen)

  const toggleList = (open: boolean) => {
    setListOpen(open)
    localStorage.setItem(LIST_STORAGE_KEY, open ? "open" : "closed")
  }

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

  // Wider window around the anchor date, only fetched for `?event=` links.
  const wideRange = useMemo(() => {
    const center = anchorDate(dateParam, timezone).getTime()
    return {
      from: new Date(center - DEEP_LINK_WINDOW_MS).toISOString(),
      to: new Date(center + DEEP_LINK_WINDOW_MS).toISOString(),
    }
  }, [dateParam, timezone])
  const wideEvents = useQuery({
    ...calendarEventsQuery(wideRange.from, wideRange.to),
    enabled: eventParam !== undefined,
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

  // The `?event=` occurrence, from the visible range first, then the wider window.
  const deepOccurrence = useMemo(() => {
    if (eventParam === undefined) return undefined
    return (
      occurrences.find((item) => item.eventId === eventParam) ??
      wideEvents.data?.find((item) => item.eventId === eventParam)
    )
  }, [eventParam, occurrences, wideEvents.data])

  const deepTarget = useMemo<EventDialogTarget | null>(
    () =>
      deepOccurrence !== undefined && eventParam !== dismissedParam
        ? { kind: "edit", occurrence: deepOccurrence }
        : null,
    [deepOccurrence, eventParam, dismissedParam],
  )

  const activeTarget = eventTarget ?? deepTarget

  // The dialog reads links and versions from the live occurrence, so refetches show up in it.
  const liveEventTarget = useMemo<EventDialogTarget | null>(() => {
    if (activeTarget?.kind !== "edit") return activeTarget
    const live = occurrenceById.get(occurrenceKey(activeTarget.occurrence))
    return live === undefined ? activeTarget : { kind: "edit", occurrence: live }
  }, [activeTarget, occurrenceById])

  // `?event=` not found in either window: say so once, then clear the param.
  const reportedMissing = useRef<string | null>(null)
  useEffect(() => {
    if (eventParam === undefined || deepOccurrence !== undefined) return
    if (!events.isSuccess || !wideEvents.isSuccess) return
    if (reportedMissing.current === eventParam) return
    reportedMissing.current = eventParam
    toast.error(t`Event not found`)
    onEventParamDone?.()
  }, [eventParam, deepOccurrence, events.isSuccess, wideEvents.isSuccess, onEventParamDone, t])

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
    () => calendars.map((calendar) => ({ id: calendar.id, color: calendar.color })),
    [calendars],
  )

  const defaultCalendarId =
    calendars.find((calendar) => !prefs.hidden.has(calendar.id))?.id ?? calendars[0]?.id ?? null

  const openEvent = (id: string) => {
    const link = taskLinks.get(id)
    if (link !== undefined) {
      void navigate({ to: taskHref(link.projectKey, link.number) })
      return
    }
    const occurrence = occurrenceById.get(id)
    if (occurrence !== undefined) setEventTarget({ kind: "edit", occurrence })
  }

  // Context-menu target for an event occurrence. Task due dates have no occurrence, so none.
  const eventTargetFor = useCallback(
    (id: string): EntityTarget | undefined => {
      const occurrence = occurrenceById.get(id)
      if (occurrence === undefined) return undefined
      return {
        kind: "event",
        event: occurrence,
        onOpen: () => setEventTarget({ kind: "edit", occurrence }),
      }
    },
    [occurrenceById],
  )

  const createAt = (start: Date, allDay: boolean) =>
    setEventTarget({ kind: "create", start, allDay })

  return (
    <div className="flex min-w-0 flex-col gap-4 md:flex-row md:gap-6">
      {listOpen && (
        <aside id="calendar-list" className="min-w-0 md:w-64 md:shrink-0">
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
        </aside>
      )}

      <div className="isolate grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={listOpen}
            aria-controls="calendar-list"
            onClick={() => toggleList(!listOpen)}
            className="min-h-11 md:min-h-8"
          >
            <PanelLeft aria-hidden="true" />
            {listOpen ? <Trans>Hide calendars</Trans> : <Trans>Show calendars</Trans>}
          </Button>
        </div>
        {calendarsResult.isError && <ErrorMessage error={calendarsResult.error} />}
        {events.isError && <ErrorMessage error={events.error} />}
        {wideEvents.isError && eventParam !== undefined && (
          <ErrorMessage error={wideEvents.error} />
        )}
        {events.isPending && range !== null && <LoadingRows rows={1} />}
        {calendars.length === 0 && calendarsResult.isSuccess && (
          <EmptyState
            icon={CalendarDays}
            title={t`No calendars yet`}
            description={t`Create one to start adding events.`}
          />
        )}
        <CalendarBoard
          timezone={timezone}
          calendars={boardCalendars}
          events={displayEvents}
          initialDate={dateParam}
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
          eventTargetFor={eventTargetFor}
        />
      </div>

      <EventDialog
        target={liveEventTarget}
        viewerTimezone={timezone}
        userId={userId}
        calendars={calendars}
        defaultCalendarId={defaultCalendarId}
        onOpenChange={(open) => {
          if (open) return
          setEventTarget(null)
          if (eventParam !== undefined) {
            setDismissedParam(eventParam)
            onEventParamDone?.()
          }
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
