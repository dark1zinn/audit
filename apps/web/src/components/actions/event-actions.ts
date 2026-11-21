import { useLingui } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarCheck, Copy, ExternalLink, Trash2 } from "lucide-react"
import type { EventOccurrence, EventScope, ResponseStatus } from "@audit/domain/calendar/schema"
import { callApi } from "../../lib/api.ts"
import { keys } from "../../lib/queries.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { absoluteHref, useCopyText, useRunAction } from "./shared.ts"

type EventTarget = Extract<EntityTarget, { kind: "event" }>

const eventHref = (eventId: string) => `/calendar?event=${eventId}`

/** Event writes. The event menu and the event dialog share these, so each request has one place. */
export const useEventMutations = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const run = useRunAction(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.calendars })
    await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
  })
  return {
    pending: run.isPending,
    error: run.error,
    /** Deletes the occurrences `scope` names; `onDeleted` runs once the request succeeds. */
    remove: (event: EventOccurrence, scope: EventScope, onDeleted?: () => void) =>
      run.mutate(
        () =>
          callApi((api) =>
            api.calendar.deleteEvent({
              params: { eventId: event.eventId },
              payload: {
                scope,
                occurrenceStart: event.occurrenceStart,
                version: event.version,
              },
            }),
          ),
        {
          onSuccess: () => {
            toast.success(t`Event deleted`)
            onDeleted?.()
          },
        },
      ),
    rsvp: (event: EventOccurrence, response: ResponseStatus) =>
      run.mutate(
        () =>
          callApi((api) =>
            api.calendar.rsvp({ params: { eventId: event.eventId }, payload: { response } }),
          ),
        { onSuccess: () => toast.success(t`RSVP updated`) },
      ),
  }
}

export const useEventActions = (target: EventTarget | null): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const copy = useCopyText()
  const events = useEventMutations()
  if (target === null) return []
  const href = eventHref(target.event.eventId)

  return [
    [
      { id: "open", label: t`Open`, icon: ExternalLink, run: target.onOpen },
      {
        id: "rsvp",
        label: t`RSVP`,
        icon: CalendarCheck,
        children: [
          {
            id: "rsvp-accepted",
            label: t`Going`,
            run: () => events.rsvp(target.event, "accepted"),
          },
          {
            id: "rsvp-tentative",
            label: t`Maybe`,
            run: () => events.rsvp(target.event, "tentative"),
          },
          {
            id: "rsvp-declined",
            label: t`Not going`,
            run: () => events.rsvp(target.event, "declined"),
          },
        ],
      },
    ],
    [
      {
        id: "copy-link",
        label: t`Copy link`,
        icon: Copy,
        run: () => copy(absoluteHref(href), t`Link copied`),
      },
    ],
    [
      {
        id: "delete",
        label: t`Delete`,
        icon: Trash2,
        variant: "destructive",
        confirm: {
          title: t`Delete “${target.event.title}”?`,
          description: t`The event is removed from the calendar for everyone.`,
          confirmLabel: t`Delete`,
        },
        run: () => events.remove(target.event, "all"),
      },
    ],
  ]
}
