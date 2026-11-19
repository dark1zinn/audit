import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import type { RichDoc } from "@audit/domain/tasks/schema"
import type { CalendarId } from "@audit/domain/ids"
import type {
  AttendeeInput,
  CalendarSummary,
  EventInput,
  EventOccurrence,
  EventScope,
  ResponseStatus,
  UpdateEventInput,
} from "@audit/domain/calendar/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { Switch } from "@audit/ui/components/ui/switch.tsx"
import { ToggleGroup, ToggleGroupItem } from "@audit/ui/components/ui/toggle-group.tsx"
import { callApi } from "../../lib/api.ts"
import {
  addDays,
  allDayDate,
  allDayInstant,
  buildRrule,
  defaultRecurrence,
  fromWall,
  parseRecurrence,
  timeZoneOptions,
  toWall,
  type RecurrenceState,
} from "../../lib/calendar.ts"
import { membersQuery, teamsQuery } from "../../lib/queries.ts"
import { ErrorMessage } from "../feedback.tsx"
import { RichEditor } from "../task-panel/rich-editor.tsx"
import { ConfirmDialog, ScopeDialog } from "./confirm-dialogs.tsx"
import { RecurrenceFields } from "./recurrence-fields.tsx"
import { LinkedItems } from "./linked-items.tsx"

export type EventDialogTarget =
  | { readonly kind: "create"; readonly start: Date; readonly allDay: boolean }
  | { readonly kind: "edit"; readonly occurrence: EventOccurrence }

const REMINDER_OPTIONS = [0, 5, 15, 30, 60, 1440, 10080] as const
const HOUR_MS = 60 * 60 * 1000

interface EventFormState {
  readonly calendarId: CalendarId
  readonly title: string
  readonly allDay: boolean
  readonly startDate: string
  readonly startTime: string
  readonly endDate: string
  readonly endTime: string
  readonly timezone: string
  readonly recurrence: RecurrenceState
  readonly location: string
  readonly description: RichDoc | null
  /** `user:<id>` or `team:<id>` */
  readonly attendees: ReadonlyArray<string>
  readonly reminders: ReadonlyArray<number>
}

type SaveFields = Omit<EventInput, "calendarId">

const attendeeKey = (principalType: string, principalId: string) =>
  `${principalType}:${principalId}`

const parseAttendeeKey = (key: string): AttendeeInput => {
  const separator = key.indexOf(":")
  return {
    principalType: key.slice(0, separator) === "team" ? "team" : "user",
    principalId: key.slice(separator + 1),
  }
}

const initialState = (
  target: EventDialogTarget,
  viewerTimezone: string,
  defaultCalendarId: CalendarId,
): EventFormState => {
  if (target.kind === "create") {
    const wall = target.allDay
      ? { date: allDayDate(target.start), time: "09:00" }
      : toWall(target.start, viewerTimezone)
    const end = toWall(new Date(target.start.getTime() + HOUR_MS), viewerTimezone)
    return {
      calendarId: defaultCalendarId,
      title: "",
      allDay: target.allDay,
      startDate: wall.date,
      startTime: target.allDay ? "09:00" : wall.time,
      endDate: target.allDay ? wall.date : end.date,
      endTime: end.time,
      timezone: viewerTimezone,
      recurrence: defaultRecurrence(wall.date),
      location: "",
      description: null,
      attendees: [],
      reminders: [15],
    }
  }
  const { occurrence } = target
  const start = toWall(occurrence.startsAt, occurrence.timezone)
  const end = toWall(occurrence.endsAt, occurrence.timezone)
  const startDate = occurrence.allDay ? allDayDate(occurrence.startsAt) : start.date
  const lastDay = occurrence.allDay ? addDays(allDayDate(occurrence.endsAt), -1) : end.date
  return {
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    allDay: occurrence.allDay,
    startDate,
    startTime: start.time,
    endDate: lastDay < startDate ? startDate : lastDay,
    endTime: end.time,
    timezone: occurrence.timezone,
    recurrence: parseRecurrence(occurrence.rrule, occurrence.timezone, startDate),
    location: occurrence.location,
    description: occurrence.description,
    attendees: occurrence.attendees.map((attendee) =>
      attendeeKey(attendee.principalType, attendee.principalId),
    ),
    reminders: occurrence.reminders,
  }
}

export function EventDialog({
  target,
  viewerTimezone,
  userId,
  calendars,
  defaultCalendarId,
  onOpenChange,
}: {
  readonly target: EventDialogTarget | null
  readonly viewerTimezone: string
  readonly userId: string
  readonly calendars: ReadonlyArray<CalendarSummary>
  readonly defaultCalendarId: CalendarId | null
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {target !== null && defaultCalendarId !== null && (
          <EventForm
            target={target}
            viewerTimezone={viewerTimezone}
            userId={userId}
            calendars={calendars}
            defaultCalendarId={defaultCalendarId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Mounted only while the dialog is open, so its state starts fresh for every target. */
function EventForm({
  target,
  viewerTimezone,
  userId,
  calendars,
  defaultCalendarId,
  onDone,
}: {
  readonly target: EventDialogTarget
  readonly viewerTimezone: string
  readonly userId: string
  readonly calendars: ReadonlyArray<CalendarSummary>
  readonly defaultCalendarId: CalendarId
  readonly onDone: () => void
}) {
  const { t, i18n } = useLingui()
  const queryClient = useQueryClient()
  const [form, setForm] = useState(() => initialState(target, viewerTimezone, defaultCalendarId))
  const [problem, setProblem] = useState<string | null>(null)
  const [scopeAction, setScopeAction] = useState<"edit" | "delete" | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const members = useQuery(membersQuery)
  const teams = useQuery(teamsQuery)

  const occurrence = target.kind === "edit" ? target.occurrence : null
  const recurring = occurrence !== null && occurrence.rrule !== null
  const timezones = timeZoneOptions(form.timezone)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
    await queryClient.invalidateQueries({ queryKey: ["calendars"] })
  }

  /** Builds the save fields, or sets `problem` and returns `null`. */
  const fieldsFromForm = (): SaveFields | null => {
    const fail = (message: string) => {
      setProblem(message)
      return null
    }
    if (form.title.trim() === "") return fail(t`Enter a title.`)
    const { startDate, endDate } = form
    let startsAt: Date | undefined
    let endsAt: Date | undefined
    if (form.allDay) {
      if (endDate < startDate) return fail(t`The end date cannot be before the start date.`)
      startsAt = allDayInstant(startDate)
      endsAt = allDayInstant(addDays(endDate, 1))
    } else {
      startsAt = fromWall(startDate, form.startTime, form.timezone)
      endsAt = fromWall(endDate, form.endTime, form.timezone)
      if (startsAt === undefined || endsAt === undefined) {
        return fail(t`Enter a valid start and end.`)
      }
      if (endsAt.getTime() < startsAt.getTime()) {
        return fail(t`The end cannot be before the start.`)
      }
    }
    if (form.recurrence.end === "until" && form.recurrence.until < startDate) {
      return fail(t`The repeat end date is before the start.`)
    }
    return {
      title: form.title.trim(),
      startsAt,
      endsAt,
      allDay: form.allDay,
      timezone: form.timezone,
      rrule: buildRrule(form.recurrence, form.timezone, startDate),
      location: form.location.trim(),
      description: form.description,
      attendees: form.attendees.map(parseAttendeeKey),
      reminders: [...form.reminders],
    }
  }

  const save = useMutation({
    mutationFn: async (args: {
      readonly fields: SaveFields
      readonly scope: EventScope | null
    }) => {
      if (occurrence === null) {
        await callApi((api) =>
          api.calendar.createEvent({
            params: { calendarId: form.calendarId },
            payload: { ...args.fields, calendarId: form.calendarId },
          }),
        )
        return
      }
      const scope = args.scope ?? "all"
      const { fields } = args
      // "this" overrides one occurrence: series-level fields stay as they are.
      const seriesFields =
        scope === "this"
          ? {}
          : { timezone: fields.timezone, rrule: fields.rrule, calendarId: form.calendarId }
      const payload: UpdateEventInput = {
        scope,
        occurrenceStart: occurrence.occurrenceStart,
        version: occurrence.version,
        title: fields.title,
        startsAt: fields.startsAt,
        endsAt: fields.endsAt,
        allDay: fields.allDay,
        location: fields.location,
        description: fields.description,
        attendees: fields.attendees,
        reminders: fields.reminders,
        ...seriesFields,
      }
      await callApi((api) =>
        api.calendar.updateEvent({ params: { eventId: occurrence.eventId }, payload }),
      )
    },
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })

  const remove = useMutation({
    mutationFn: (scope: EventScope) => {
      if (occurrence === null) throw new Error("No occurrence to delete")
      return callApi((api) =>
        api.calendar.deleteEvent({
          params: { eventId: occurrence.eventId },
          payload: {
            scope,
            occurrenceStart: occurrence.occurrenceStart,
            version: occurrence.version,
          },
        }),
      )
    },
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })

  const rsvp = useMutation({
    mutationFn: (response: ResponseStatus) => {
      if (occurrence === null) throw new Error("No occurrence to answer")
      return callApi((api) =>
        api.calendar.rsvp({ params: { eventId: occurrence.eventId }, payload: { response } }),
      )
    },
    onSuccess: refresh,
  })

  const mine = occurrence?.attendees.find(
    (attendee) => attendee.principalType === "user" && attendee.principalId === userId,
  )

  /** Response label for an attendee the event already lists; `undefined` when not an attendee. */
  const responseLabel = (key: string): string | undefined => {
    const attendee = occurrence?.attendees.find(
      (candidate) => attendeeKey(candidate.principalType, candidate.principalId) === key,
    )
    if (attendee === undefined) return undefined
    switch (attendee.response) {
      case "accepted":
        return t`Accepted`
      case "tentative":
        return t`Maybe`
      case "declined":
        return t`Declined`
      case "needs_action":
        return t`No response`
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProblem(null)
    const fields = fieldsFromForm()
    if (fields === null) return
    if (recurring) {
      setScopeAction("edit")
      setPendingFields(fields)
      return
    }
    save.mutate({ fields, scope: null })
  }

  const [pendingFields, setPendingFields] = useState<SaveFields | null>(null)

  const toggleAttendee = (key: string, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      attendees: checked ? [...prev.attendees, key] : prev.attendees.filter((item) => item !== key),
    }))

  const toggleReminder = (minutes: number, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      reminders: checked
        ? [...prev.reminders, minutes].sort((a, b) => a - b)
        : prev.reminders.filter((item) => item !== minutes),
    }))

  const reminderLabel = (minutes: number) => {
    switch (minutes) {
      case 0:
        return t`At start`
      case 5:
        return t`5 minutes before`
      case 15:
        return t`15 minutes before`
      case 30:
        return t`30 minutes before`
      case 60:
        return t`1 hour before`
      case 1440:
        return t`1 day before`
      default:
        return t`1 week before`
    }
  }

  const pending = save.isPending || remove.isPending || rsvp.isPending
  const mutationError = save.error ?? remove.error ?? rsvp.error

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {occurrence === null ? <Trans>New event</Trans> : <Trans>Edit event</Trans>}
        </DialogTitle>
        <DialogDescription>
          {recurring ? <Trans>Part of a repeating series.</Trans> : <Trans>One-time event.</Trans>}
        </DialogDescription>
      </DialogHeader>

      <form id="event-form" className="grid gap-4" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="event-title">
              <span>{t`Title`}</span>
            </Label>
            <Input
              id="event-title"
              required
              maxLength={300}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.currentTarget.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-calendar">
              <span>{t`Calendar`}</span>
            </Label>
            <Select
              value={form.calendarId}
              onValueChange={(value) => setForm({ ...form, calendarId: value as CalendarId })}
            >
              <SelectTrigger id="event-calendar" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((calendar) => (
                  <SelectItem key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 self-end">
            <Switch
              id="event-allday"
              checked={form.allDay}
              onCheckedChange={(checked) => setForm({ ...form, allDay: checked })}
            />
            <Label htmlFor="event-allday">
              <span>{t`All day`}</span>
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-start-date">
              <span>{t`Starts`}</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="event-start-date"
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.currentTarget.value })}
              />
              {!form.allDay && (
                <Input
                  aria-label={t`Start time`}
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.currentTarget.value })}
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-end-date">
              <span>{t`Ends`}</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="event-end-date"
                type="date"
                required
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.currentTarget.value })}
              />
              {!form.allDay && (
                <Input
                  aria-label={t`End time`}
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.currentTarget.value })}
                />
              )}
            </div>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="event-timezone">
              <span>{t`Time zone`}</span>
            </Label>
            <Select
              value={form.timezone}
              onValueChange={(value) => setForm({ ...form, timezone: value })}
            >
              <SelectTrigger id="event-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <RecurrenceFields
          id="event-repeat"
          value={form.recurrence}
          locale={i18n.locale}
          onChange={(recurrence) => setForm({ ...form, recurrence })}
        />

        <div className="space-y-2">
          <Label htmlFor="event-location">
            <span>{t`Location`}</span>
          </Label>
          <Input
            id="event-location"
            maxLength={300}
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.currentTarget.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>
            <span>{t`Description`}</span>
          </Label>
          <RichEditor
            value={form.description}
            editable
            label={t`Description`}
            onChange={(description) => setForm({ ...form, description })}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            <Trans>Attendees</Trans>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(members.data ?? [])
              .filter((member) => member.deactivatedAt === null)
              .map((member) => {
                const key = attendeeKey("user", member.userId)
                return (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.attendees.includes(key)}
                      onCheckedChange={(checked) => toggleAttendee(key, checked === true)}
                    />
                    <span>{member.displayName}</span>
                    {responseLabel(key) !== undefined && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {responseLabel(key)}
                      </span>
                    )}
                  </label>
                )
              })}
            {(teams.data ?? []).map((team) => {
              const key = attendeeKey("team", team.id)
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.attendees.includes(key)}
                    onCheckedChange={(checked) => toggleAttendee(key, checked === true)}
                  />
                  <span>{t`Team: ${team.name}`}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {mine !== undefined && (
          <div className="space-y-2">
            <Label>
              <span>{t`Your response`}</span>
            </Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mine.response}
              onValueChange={(value) => {
                if (value !== "") rsvp.mutate(value as ResponseStatus)
              }}
              aria-label={t`Your response`}
            >
              <ToggleGroupItem value="accepted">{t`Accept`}</ToggleGroupItem>
              <ToggleGroupItem value="tentative">{t`Maybe`}</ToggleGroupItem>
              <ToggleGroupItem value="declined">{t`Decline`}</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            <Trans>Reminders</Trans>
          </legend>
          <div className="flex flex-wrap gap-3">
            {REMINDER_OPTIONS.map((minutes) => (
              <label key={minutes} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.reminders.includes(minutes)}
                  onCheckedChange={(checked) => toggleReminder(minutes, checked === true)}
                />
                <span>{reminderLabel(minutes)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {problem !== null && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
        {mutationError !== null && <ErrorMessage error={mutationError} />}
      </form>

      {occurrence !== null ? (
        <LinkedItems eventId={occurrence.eventId} links={occurrence.links} />
      ) : (
        <p className="text-sm text-muted-foreground">
          <Trans>Save the event first to link tasks and docs.</Trans>
        </p>
      )}

      <DialogFooter className="flex-wrap sm:justify-between">
        <div>
          {occurrence !== null && (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => (recurring ? setScopeAction("delete") : setConfirmingDelete(true))}
            >
              <Trans>Delete</Trans>
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" form="event-form" disabled={pending}>
            <Trans>Save</Trans>
          </Button>
        </div>
      </DialogFooter>

      {scopeAction === "edit" && pendingFields !== null && (
        <ScopeDialog
          open
          action="edit"
          recurring
          pending={pending}
          error={null}
          onChoose={(scope) => save.mutate({ fields: pendingFields, scope })}
          onOpenChange={(open) => {
            if (!open) setScopeAction(null)
          }}
        />
      )}
      {scopeAction === "delete" && occurrence !== null && (
        <ScopeDialog
          open
          action="delete"
          recurring
          pending={pending}
          error={remove.error}
          onChoose={(scope) => remove.mutate(scope)}
          onOpenChange={(open) => {
            if (!open) setScopeAction(null)
          }}
        />
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title={t`Delete event`}
        description={t`This action cannot be undone.`}
        confirmLabel={t`Delete`}
        pending={pending}
        error={remove.error}
        onConfirm={() => remove.mutate("all")}
        onOpenChange={setConfirmingDelete}
      />
    </>
  )
}
