import { useLingui } from "@lingui/react/macro"
import type { ActivityEntry } from "@audit/domain/tasks/schema"

interface ActivitySectionProps {
  readonly entries: ReadonlyArray<ActivityEntry>
}

export function ActivitySection({ entries }: ActivitySectionProps) {
  const { t, i18n } = useLingui()
  const formatter = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  const newestFirst = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const actionLabel = (action: string): string => {
    switch (action) {
      case "task.created":
        return t`Created the task`
      case "task.updated":
        return t`Updated the task`
      case "task.moved":
        return t`Moved the task`
      case "task.deleted":
        return t`Deleted the task`
      case "task.restored":
        return t`Restored the task`
      case "comment.created":
        return t`Commented`
      case "comment.updated":
        return t`Edited a comment`
      case "comment.deleted":
        return t`Deleted a comment`
      default:
        return action
    }
  }

  return (
    <section aria-labelledby="task-activity-heading" className="space-y-3">
      <h2 id="task-activity-heading" className="text-base font-semibold">
        {t`Activity`}
      </h2>
      {newestFirst.length === 0 && (
        <p className="text-sm text-muted-foreground">{t`No activity yet.`}</p>
      )}
      <ol className="space-y-2 text-sm">
        {newestFirst.map((entry) => (
          <li key={entry.id} className="flex flex-wrap gap-x-2">
            <span>{actionLabel(entry.action)}</span>
            <time className="text-muted-foreground" dateTime={entry.createdAt.toISOString()}>
              {formatter.format(entry.createdAt)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  )
}
