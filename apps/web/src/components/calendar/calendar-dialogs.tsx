import { Plural, Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import type { CalendarSummary } from "@audit/domain/calendar/schema"
import type { ProjectId, TeamId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { callApi } from "../../lib/api.ts"
import { formValue, TextField } from "../form.tsx"
import { ErrorMessage } from "../feedback.tsx"
import { teamsQuery } from "../../lib/queries.ts"
import { ConfirmDialog } from "./confirm-dialogs.tsx"
import { useCalendarMutations } from "../actions/calendar-actions.ts"

export type CalendarDialogTarget =
  | { readonly kind: "create"; readonly projectId?: ProjectId }
  | { readonly kind: "edit"; readonly calendar: CalendarSummary }

const NO_TEAM = "none"

/** Creates, renames, recolours or deletes a calendar. Personal calendars have no team. */
export function CalendarDialog({
  target,
  onOpenChange,
}: {
  readonly target: CalendarDialogTarget | null
  readonly onOpenChange: (open: boolean) => void
}) {
  const { t } = useLingui()
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target !== null && (
          <CalendarForm
            key={target.kind === "edit" ? target.calendar.id : "new"}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        )}
        <span className="sr-only">{t`Calendar settings`}</span>
      </DialogContent>
    </Dialog>
  )
}

function CalendarForm({
  target,
  onDone,
}: {
  readonly target: CalendarDialogTarget
  readonly onDone: () => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const teams = useQuery(teamsQuery)
  const calendar = target.kind === "edit" ? target.calendar : null
  const projectId = target.kind === "create" ? (target.projectId ?? null) : null
  const [color, setColor] = useState(calendar?.color ?? "#3b82f6")
  const [teamId, setTeamId] = useState(NO_TEAM)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["calendars"] })
    await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
  }

  const save = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const name = formValue(form, "name").trim()
      if (calendar === null) {
        // A project calendar belongs to the project; otherwise the owner is a team or the caller.
        const owner =
          projectId !== null
            ? { projectId }
            : { teamId: teamId === NO_TEAM ? null : (teamId as TeamId) }
        return callApi((api) => api.calendar.createCalendar({ payload: { name, color, ...owner } }))
      }
      return callApi((api) =>
        api.calendar.updateCalendar({
          params: { calendarId: calendar.id },
          payload: { name, color, version: calendar.version },
        }),
      )
    },
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })

  const calendars = useCalendarMutations()

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(event.currentTarget)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {calendar === null ? <Trans>New calendar</Trans> : <Trans>Calendar settings</Trans>}
        </DialogTitle>
        <DialogDescription>
          <Trans>Events in a calendar appear for everyone who can see it.</Trans>
        </DialogDescription>
      </DialogHeader>
      <form id="calendar-form" className="grid gap-3" onSubmit={onSubmit}>
        <TextField
          name="name"
          label={t`Name`}
          required
          maxLength={120}
          defaultValue={calendar?.name ?? ""}
        />
        <div className="space-y-2">
          <Label htmlFor="calendar-color">
            <span>{t`Colour`}</span>
          </Label>
          <Input
            id="calendar-color"
            type="color"
            className="h-10 w-20 p-1"
            value={color}
            onChange={(event) => setColor(event.currentTarget.value)}
          />
        </div>
        {calendar === null && projectId === null && (
          <div className="space-y-2">
            <Label htmlFor="calendar-team">
              <span>{t`Owner`}</span>
            </Label>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger id="calendar-team" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEAM}>{t`Only me`}</SelectItem>
                {(teams.data ?? []).map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {save.error !== null && <ErrorMessage error={save.error} />}
      </form>
      <DialogFooter className="flex-wrap sm:justify-between">
        <div>
          {calendar !== null && (
            <Button
              type="button"
              variant="destructive"
              disabled={calendars.pending}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trans>Delete calendar</Trans>
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" form="calendar-form" disabled={save.isPending}>
            {calendar === null ? <Trans>Create calendar</Trans> : <Trans>Save</Trans>}
          </Button>
        </div>
      </DialogFooter>
      {calendar !== null && (
        <ConfirmDialog
          open={confirmingDelete}
          title={t`Delete calendar`}
          description={t`The calendar and all of its events will be removed.`}
          confirmLabel={t`Delete`}
          pending={calendars.pending}
          error={calendars.error}
          onConfirm={() => {
            if (calendar !== null) calendars.remove(calendar, onDone)
          }}
          onOpenChange={setConfirmingDelete}
        />
      )}
    </>
  )
}

/** Imports events from an `.ics` file into one calendar. */
export function ImportDialog({
  calendar,
  onOpenChange,
}: {
  readonly calendar: CalendarSummary | null
  readonly onOpenChange: (open: boolean) => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [imported, setImported] = useState<number | null>(null)

  const importFile = useMutation({
    mutationFn: async (target: CalendarSummary) => {
      if (file === null) throw new Error("No file selected")
      const ics = await file.text()
      return callApi((api) =>
        api.calendar.importIcs({
          params: { calendarId: target.id },
          payload: { calendarId: target.id, ics },
        }),
      )
    },
    onSuccess: async (result) => {
      setImported(result.imported)
      await queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
    },
  })

  return (
    <Dialog
      open={calendar !== null}
      onOpenChange={(open) => {
        if (!open) {
          setFile(null)
          setImported(null)
          importFile.reset()
        }
        onOpenChange(open)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Import events</Trans>
          </DialogTitle>
          <DialogDescription>
            {calendar !== null && (
              <Trans>Adds the events from an .ics file to {calendar.name}.</Trans>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor="ics-file">
            <span>{t`iCalendar file`}</span>
          </Label>
          <Input
            id="ics-file"
            type="file"
            accept=".ics,text/calendar"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          />
          {imported !== null && (
            <output className="text-sm">
              <Plural value={imported} one="# event imported." other="# events imported." />
            </output>
          )}
          {importFile.error !== null && <ErrorMessage error={importFile.error} />}
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={file === null || calendar === null || importFile.isPending}
            onClick={() => {
              if (calendar !== null) importFile.mutate(calendar)
            }}
          >
            <Trans>Import</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
