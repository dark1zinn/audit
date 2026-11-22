import { useLingui } from "@lingui/react/macro"
import { useEffect, useState, type ReactNode } from "react"
import { SlidersHorizontal } from "lucide-react"
import type { Label } from "@audit/domain/projects/schema"
import type { Member } from "@audit/domain/identity/schema"
import type { ListTasksQuery } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label as FieldLabel } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { fieldWidth } from "../form.tsx"
import { type FilterPatch } from "./board-model.ts"
import { COLUMN_CATEGORIES, PRIORITIES, useCategoryLabels, usePriorityLabels } from "./hooks.ts"

/** Radix Select forbids empty item values, so "all" stands for "no filter". */
const ANY = "all"

export interface FiltersBarProps {
  readonly query: ListTasksQuery
  readonly labels: ReadonlyArray<Label>
  readonly members: ReadonlyArray<Member>
  readonly onPatch: (patch: FilterPatch) => void
  readonly onReset: () => void
  /** Saved views and board actions. Right-aligned on their own row from `xl`. */
  readonly actions?: ReactNode
}

/**
 * Search stays visible at every width. The other controls sit in a "Filters" disclosure below
 * `xl`, so the columns keep most of the viewport height on tablets and phones.
 */
export function FiltersBar({ query, labels, members, onPatch, onReset, actions }: FiltersBarProps) {
  const { t } = useLingui()
  const priorityLabels = usePriorityLabels()
  const categoryLabels = useCategoryLabels()
  const [text, setText] = useState(query.text ?? "")
  const [syncedText, setSyncedText] = useState(query.text)
  const [open, setOpen] = useState(false)
  if (syncedText !== query.text) {
    setSyncedText(query.text)
    setText(query.text ?? "")
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = text.trim()
      if (next !== (query.text ?? "")) onPatch({ text: next })
    }, 300)
    return () => window.clearTimeout(handle)
  }, [text, query.text, onPatch])

  const hasFilters = Object.keys(query).length > 0
  const activeCount = [
    query.assigneeId,
    query.labelId,
    query.priority,
    query.category,
    query.dueAfter,
    query.dueBefore,
    query.mentionsMe === true ? "yes" : undefined,
  ].filter((value) => value !== undefined && value !== "").length

  return (
    <fieldset className="m-0 flex w-full min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{t`Filters`}</legend>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t`Search tasks`}
          aria-label={t`Search tasks`}
          className={fieldWidth.sm}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="xl:hidden"
          aria-expanded={open}
          aria-controls="board-filter-controls"
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          {t`Filters`}
          {activeCount > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </div>
      <div
        id="board-filter-controls"
        className={`${open ? "flex" : "hidden"} flex-wrap items-center gap-2 xl:flex`}
      >
        <Select
          value={query.assigneeId ?? ANY}
          onValueChange={(value) => onPatch({ assigneeId: value === ANY ? undefined : value })}
        >
          <SelectTrigger aria-label={t`Assignee`} className={fieldWidth.xs}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t`Assignee`}</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={query.labelId ?? ANY}
          onValueChange={(value) => onPatch({ labelId: value === ANY ? undefined : value })}
        >
          <SelectTrigger aria-label={t`Label`} className={fieldWidth.xs}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t`Label`}</SelectItem>
            {labels.map((label) => (
              <SelectItem key={label.id} value={label.id}>
                {label.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={query.priority ?? ANY}
          onValueChange={(value) =>
            onPatch({ priority: value === ANY ? undefined : (value as ListTasksQuery["priority"]) })
          }
        >
          <SelectTrigger aria-label={t`Priority`} className={fieldWidth.xs}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t`Priority`}</SelectItem>
            {PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priorityLabels[priority]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={query.category ?? ANY}
          onValueChange={(value) =>
            onPatch({ category: value === ANY ? undefined : (value as ListTasksQuery["category"]) })
          }
        >
          <SelectTrigger aria-label={t`Column type`} className={fieldWidth.xs}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t`Column type`}</SelectItem>
            {COLUMN_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {categoryLabels[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldLabel className="flex items-center gap-2 text-sm">
          {t`Due from`}
          <Input
            type="date"
            value={query.dueAfter ?? ""}
            onChange={(event) => onPatch({ dueAfter: event.target.value })}
            className={fieldWidth.xs}
          />
        </FieldLabel>
        <FieldLabel className="flex items-center gap-2 text-sm">
          {t`Due before`}
          <Input
            type="date"
            value={query.dueBefore ?? ""}
            onChange={(event) => onPatch({ dueBefore: event.target.value })}
            className={fieldWidth.xs}
          />
        </FieldLabel>
        <FieldLabel className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={query.mentionsMe === true}
            onCheckedChange={(checked) => onPatch({ mentionsMe: checked === true })}
          />
          {t`Mentions me`}
        </FieldLabel>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t`Clear filters`}
          </Button>
        ) : null}
        {actions === undefined ? null : (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">{actions}</div>
        )}
      </div>
    </fieldset>
  )
}
