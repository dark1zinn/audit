import { useLingui } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarCheck, Copy, ExternalLink, Trash2 } from "lucide-react"
import type { EventOccurrence, EventScope, ResponseStatus } from "@audit/domain/calendar/schema"
import { callApi } from "../../lib/api.ts"
import { keys } from "../../lib/queries.ts"
import type { ActionGroup, EntityAction, EntityTarget } from "./types.ts"
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
  const { event } = target
  const href = eventHref(event.eventId)
  const confirm = {
    title: t`Delete “${event.title}”?`,
    description: t`The event is removed from the calendar for everyone.`,
    confirmLabel: t`Delete`,
  }

  // One-off events delete directly; recurring ones ask which occurrences the delete covers.
  const deleteItem: EntityAction =
    event.rrule === null
      ? {
          id: "delete",
          label: t`Delete`,
          icon: Trash2,
          variant: "destructive",
          confirm,
          run: () => events.remove(event, "all"),
        }
      : {
          id: "delete",
          label: t`Delete`,
          icon: Trash2,
          variant: "destructive",
          children: [
            {
              id: "delete-this",
              label: t`This event`,
              variant: "destructive",
              confirm,
              run: () => events.remove(event, "this"),
            },
            {
              id: "delete-following",
              label: t`This and following events`,
              variant: "destructive",
              confirm,
              run: () => events.remove(event, "following"),
            },
            {
              id: "delete-all",
              label: t`All events in the series`,
              variant: "destructive",
              confirm,
              run: () => events.remove(event, "all"),
            },
          ],
        }

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
            run: () => events.rsvp(event, "accepted"),
          },
          {
            id: "rsvp-tentative",
            label: t`Maybe`,
            run: () => events.rsvp(event, "tentative"),
          },
          {
            id: "rsvp-declined",
            label: t`Not going`,
            run: () => events.rsvp(event, "declined"),
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
    [deleteItem],
  ]
}
