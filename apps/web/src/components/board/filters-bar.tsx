import { useLingui } from "@lingui/react/macro"
import { useEffect, useState } from "react"
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
}

export function FiltersBar({ query, labels, members, onPatch, onReset }: FiltersBarProps) {
  const { t } = useLingui()
  const priorityLabels = usePriorityLabels()
  const categoryLabels = useCategoryLabels()
  const [text, setText] = useState(query.text ?? "")
  const [syncedText, setSyncedText] = useState(query.text)
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

  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">{t`Filters`}</legend>
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t`Search tasks`}
        aria-label={t`Search tasks`}
        className="min-w-56 max-w-full"
      />
      <Select
        value={query.assigneeId ?? ANY}
        onValueChange={(value) => onPatch({ assigneeId: value === ANY ? undefined : value })}
      >
        <SelectTrigger aria-label={t`Assignee`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t`Any assignee`}</SelectItem>
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
        <SelectTrigger aria-label={t`Label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t`Any label`}</SelectItem>
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
        <SelectTrigger aria-label={t`Priority`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t`Any priority`}</SelectItem>
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
        <SelectTrigger aria-label={t`Column type`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t`Any column type`}</SelectItem>
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
          className="w-auto"
        />
      </FieldLabel>
      <FieldLabel className="flex items-center gap-2 text-sm">
        {t`Due before`}
        <Input
          type="date"
          value={query.dueBefore ?? ""}
          onChange={(event) => onPatch({ dueBefore: event.target.value })}
          className="w-auto"
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
    </fieldset>
  )
}
