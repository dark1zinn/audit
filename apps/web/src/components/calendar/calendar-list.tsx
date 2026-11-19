import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { CalendarSummary } from "@audit/domain/calendar/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import { toast } from "sonner"
import { callApi } from "../../lib/api.ts"
import { ErrorMessage } from "../feedback.tsx"

/** Calendar sidebar: visibility, colour, per-calendar actions and the task overlay toggle. */
export function CalendarList({
  calendars,
  hidden,
  showTasks,
  onVisibleChange,
  onShowTasksChange,
  onNew,
  onEdit,
  onImport,
}: {
  readonly calendars: ReadonlyArray<CalendarSummary>
  readonly hidden: ReadonlySet<string>
  readonly showTasks: boolean
  readonly onVisibleChange: (calendarId: string, visible: boolean) => void
  readonly onShowTasksChange: (show: boolean) => void
  readonly onNew: () => void
  readonly onEdit: (calendar: CalendarSummary) => void
  readonly onImport: (calendar: CalendarSummary) => void
}) {
  const { t } = useLingui()
  return (
    <section aria-labelledby="calendar-list-title" className="grid gap-4 content-start">
      <div className="flex items-center justify-between gap-2">
        <h2 id="calendar-list-title" className="text-sm font-semibold">
          <Trans>Calendars</Trans>
        </h2>
        <Button size="sm" variant="outline" onClick={onNew}>
          <Trans>New calendar</Trans>
        </Button>
      </div>

      <ul className="grid gap-2">
        {calendars.map((calendar) => (
          <CalendarRow
            key={calendar.id}
            calendar={calendar}
            visible={!hidden.has(calendar.id)}
            onVisibleChange={onVisibleChange}
            onEdit={onEdit}
            onImport={onImport}
            label={t`Show ${calendar.name}`}
          />
        ))}
      </ul>

      <label htmlFor="calendar-show-tasks" className="flex items-center gap-2 text-sm">
        <Checkbox
          id="calendar-show-tasks"
          checked={showTasks}
          onCheckedChange={(checked) => onShowTasksChange(checked === true)}
        />
        <span>
          <Trans>Show task due dates</Trans>
        </span>
      </label>

      <IcsFeedPanel />
    </section>
  )
}

function CalendarRow({
  calendar,
  visible,
  label,
  onVisibleChange,
  onEdit,
  onImport,
}: {
  readonly calendar: CalendarSummary
  readonly visible: boolean
  readonly label: string
  readonly onVisibleChange: (calendarId: string, visible: boolean) => void
  readonly onEdit: (calendar: CalendarSummary) => void
  readonly onImport: (calendar: CalendarSummary) => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const recolour = useMutation({
    mutationFn: (color: string) =>
      callApi((api) =>
        api.calendar.updateCalendar({
          params: { calendarId: calendar.id },
          payload: { color, version: calendar.version },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendars"] }),
  })

  return (
    <li className="grid gap-1">
      <div className="flex items-center gap-2">
        <Checkbox
          aria-label={label}
          checked={visible}
          onCheckedChange={(checked) => onVisibleChange(calendar.id, checked === true)}
        />
        <Input
          type="color"
          aria-label={t`Colour of ${calendar.name}`}
          className="h-7 w-8 shrink-0 p-0.5"
          value={calendar.color}
          onChange={(event) => recolour.mutate(event.currentTarget.value)}
        />
        <span className="min-w-0 flex-1 truncate text-sm">{calendar.name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label={t`Actions for ${calendar.name}`}>
              …
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(calendar)}>
              <Trans>Settings</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onImport(calendar)}>
              <Trans>Import .ics</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {recolour.error !== null && <ErrorMessage error={recolour.error} />}
    </li>
  )
}

/** Generates or regenerates the personal read-only ICS subscription URL. */
function IcsFeedPanel() {
  const { t } = useLingui()
  const [url, setUrl] = useState<string | null>(null)
  const generate = useMutation({
    mutationFn: () => callApi((api) => api.calendar.regenerateIcalFeed()),
    onSuccess: (result) => setUrl(result.url),
  })

  const copy = async () => {
    if (url === null) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t`Feed link copied`)
    } catch {
      toast.error(t`Could not copy the link`)
    }
  }

  return (
    <div className="grid gap-2 border-t pt-4">
      <h3 className="text-sm font-semibold">
        <Trans>Subscribe in another app</Trans>
      </h3>
      <p className="text-xs text-muted-foreground">
        <Trans>
          Anyone with this link can read your calendars. Regenerate it to revoke access.
        </Trans>
      </p>
      {url !== null && (
        <div className="flex gap-2">
          <Input readOnly aria-label={t`Feed link`} value={url} className="text-xs" />
          <Button size="sm" variant="outline" onClick={copy}>
            <Trans>Copy</Trans>
          </Button>
        </div>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={generate.isPending}
        onClick={() => generate.mutate()}
      >
        {url === null ? <Trans>Generate link</Trans> : <Trans>Regenerate link</Trans>}
      </Button>
      {generate.error !== null && <ErrorMessage error={generate.error} />}
    </div>
  )
}
