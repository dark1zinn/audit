import { Trans, useLingui } from "@lingui/react/macro"
import { useState } from "react"
import type { CalendarSummary } from "@audit/domain/calendar/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { toast } from "sonner"
import { useCalendarMutations } from "../actions/calendar-actions.ts"
import { EntityActionsButton, EntityContextMenu } from "../actions/entity-menu.tsx"
import type { EntityTarget } from "../actions/types.ts"
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
  const mutations = useCalendarMutations()

  const target: EntityTarget = {
    kind: "calendar",
    calendar,
    onEdit: () => onEdit(calendar),
    onImport: () => onImport(calendar),
  }
  return (
    <li className="grid gap-1">
      <EntityContextMenu target={target}>
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
            onChange={(event) => mutations.recolour(calendar, event.currentTarget.value)}
          />
          <span className="min-w-0 flex-1 truncate text-sm">{calendar.name}</span>
          <EntityActionsButton target={target} label={t`Actions for ${calendar.name}`} />
        </div>
      </EntityContextMenu>
      {mutations.error !== null && <ErrorMessage error={mutations.error} />}
    </li>
  )
}

/** Generates or regenerates the personal read-only ICS subscription URL. */
function IcsFeedPanel() {
  const { t } = useLingui()
  const [url, setUrl] = useState<string | null>(null)
  const feed = useCalendarMutations()

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
        disabled={feed.pending}
        onClick={() => feed.regenerateFeed(setUrl)}
      >
        {url === null ? <Trans>Generate link</Trans> : <Trans>Regenerate link</Trans>}
      </Button>
      {feed.error !== null && <ErrorMessage error={feed.error} />}
    </div>
  )
}
