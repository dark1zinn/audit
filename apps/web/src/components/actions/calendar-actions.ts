import { useLingui } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { FileUp, RefreshCw, Settings, Trash2 } from "lucide-react"
import type { CalendarSummary } from "@audit/domain/calendar/schema"
import { callApi } from "../../lib/api.ts"
import { keys } from "../../lib/queries.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { useRunAction } from "./shared.ts"

type CalendarTarget = Extract<EntityTarget, { kind: "calendar" }>

/** Calendar writes. The calendar menu and the sidebar controls (colour, feed link) share these. */
export const useCalendarMutations = () => {
  const queryClient = useQueryClient()
  const run = useRunAction(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.calendars })
    await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
  })
  return {
    pending: run.isPending,
    error: run.error,
    recolour: (calendar: CalendarSummary, color: string) =>
      run.mutate(() =>
        callApi((api) =>
          api.calendar.updateCalendar({
            params: { calendarId: calendar.id },
            payload: { color, version: calendar.version },
          }),
        ),
      ),
    /** Issues a new feed link; `onUrl` receives it for callers that display it. */
    regenerateFeed: (onUrl?: (url: string) => void) =>
      run.mutate(async () => {
        const result = await callApi((api) => api.calendar.regenerateIcalFeed())
        onUrl?.(result.url)
      }),
    remove: (calendar: CalendarSummary, onDeleted?: () => void) =>
      run.mutate(
        () =>
          callApi((api) => api.calendar.deleteCalendar({ params: { calendarId: calendar.id } })),
        { onSuccess: () => onDeleted?.() },
      ),
  }
}

export const useCalendarActions = (target: CalendarTarget | null): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const calendars = useCalendarMutations()
  if (target === null) return []

  return [
    [
      { id: "settings", label: t`Settings`, icon: Settings, run: target.onEdit },
      { id: "import", label: t`Import .ics`, icon: FileUp, run: target.onImport },
      {
        id: "regenerate-feed",
        label: t`Regenerate feed link`,
        icon: RefreshCw,
        confirm: {
          title: t`Regenerate feed link?`,
          description: t`The current feed link stops working.`,
          confirmLabel: t`Regenerate`,
        },
        run: () => calendars.regenerateFeed(),
      },
    ],
    [
      {
        id: "delete",
        label: t`Delete`,
        icon: Trash2,
        variant: "destructive",
        confirm: {
          title: t`Delete “${target.calendar.name}”?`,
          description: t`Its events are deleted with it.`,
          confirmLabel: t`Delete`,
        },
        run: () => calendars.remove(target.calendar),
      },
    ],
  ]
}
