import { useLingui } from "@lingui/react/macro"
import type { ColumnCategory } from "@audit/domain/projects/schema"
import type { Priority } from "@audit/domain/tasks/schema"

/** Translated display names for task priorities and column categories. */
export function useTaskText() {
  const { t } = useLingui()
  const priorities: Record<Priority, string> = {
    none: t`No priority`,
    low: t`Low`,
    medium: t`Medium`,
    high: t`High`,
    urgent: t`Urgent`,
  }
  const categories: Record<ColumnCategory, string> = {
    backlog: t`Backlog`,
    todo: t`To do`,
    in_progress: t`In progress`,
    done: t`Done`,
    canceled: t`Canceled`,
  }
  return { priorities, categories }
}
