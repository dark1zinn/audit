import { useLingui, Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useId, useState } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
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
import type { ProjectId } from "@audit/domain/ids"
import type { ListTasksQuery } from "@audit/domain/tasks/schema"
import { labelsQuery, membersQuery } from "../../lib/queries.ts"
import { countActiveFilters } from "./task-search.ts"
import { useTaskText } from "./task-labels.ts"

const ALL = "all"

/**
 * Filters, sort and group-by controls. Every change is a patch of the URL search params, so the
 * view is shareable and survives reloads. `projectId` enables the project-scoped label and
 * assignee filters; `sorting` and `grouping` switch on the matching controls for this view.
 */
export function TaskFilterBar({
  projectId,
  query,
  onChange,
  sorting,
  grouping,
}: {
  readonly projectId: ProjectId | null
  readonly query: ListTasksQuery
  readonly onChange: (patch: Partial<Record<keyof ListTasksQuery, unknown>>) => void
  readonly sorting: boolean
  readonly grouping: boolean
}) {
  const { t } = useLingui()
  const { priorities, categories } = useTaskText()
  const [draft, setDraft] = useState(query.text ?? "")
  const activeCount = countActiveFilters(query)

  // Debounce free-text search so typing does not navigate on every keystroke.
  useEffect(() => {
    const next = draft.trim()
    if (next === (query.text ?? "")) return
    const timer = setTimeout(() => onChange({ text: next === "" ? undefined : next }), 300)
    return () => clearTimeout(timer)
  }, [draft, query.text, onChange])

  const clear = () => {
    setDraft("")
    onChange({
      text: undefined,
      priority: undefined,
      category: undefined,
      labelId: undefined,
      assigneeId: undefined,
      dueAfter: undefined,
      dueBefore: undefined,
      mentionsMe: undefined,
    })
  }

  const sortDir = query.sortDir ?? "asc"

  return (
    <search
      aria-label={t`Filter tasks`}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => event.preventDefault()}
    >
      <Input
        type="search"
        aria-label={t`Search tasks`}
        placeholder={t`Search tasks`}
        className="w-56"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
      <Select
        value={query.priority ?? ALL}
        onValueChange={(value) => onChange({ priority: value === ALL ? undefined : value })}
      >
        <SelectTrigger aria-label={t`Priority`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t`Any priority`}</SelectItem>
          {(["urgent", "high", "medium", "low", "none"] as const).map((priority) => (
            <SelectItem key={priority} value={priority}>
              {priorities[priority]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={query.category ?? ALL}
        onValueChange={(value) => onChange({ category: value === ALL ? undefined : value })}
      >
        <SelectTrigger aria-label={t`Status`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t`Any status`}</SelectItem>
          {(["backlog", "todo", "in_progress", "done", "canceled"] as const).map((category) => (
            <SelectItem key={category} value={category}>
              {categories[category]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {projectId !== null && (
        <ProjectFilters
          projectId={projectId}
          labelId={query.labelId}
          assigneeId={query.assigneeId}
          onChange={onChange}
        />
      )}
      <DueDateInput
        label={t`Due on or after`}
        value={query.dueAfter}
        onChange={(value) => onChange({ dueAfter: value })}
      />
      <DueDateInput
        label={t`Due before`}
        value={query.dueBefore}
        onChange={(value) => onChange({ dueBefore: value })}
      />
      <MentionsMeToggle
        checked={query.mentionsMe === true}
        onChange={(checked) => onChange({ mentionsMe: checked ? true : undefined })}
      />
      {sorting && (
        <>
          <Select
            value={query.sort ?? "position"}
            onValueChange={(value) => onChange({ sort: value })}
          >
            <SelectTrigger aria-label={t`Sort by`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="position">{t`Manual order`}</SelectItem>
              <SelectItem value="priority">{t`Priority`}</SelectItem>
              <SelectItem value="dueAt">{t`Due date`}</SelectItem>
              <SelectItem value="updatedAt">{t`Last updated`}</SelectItem>
              <SelectItem value="number">{t`Task number`}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={sortDir === "asc" ? t`Sort ascending` : t`Sort descending`}
            aria-pressed={sortDir === "desc"}
            onClick={() => onChange({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
          >
            {sortDir === "asc" ? t`Ascending` : t`Descending`}
          </Button>
        </>
      )}
      {grouping && (
        <Select
          value={query.groupBy ?? "none"}
          onValueChange={(value) => onChange({ groupBy: value === "none" ? undefined : value })}
        >
          <SelectTrigger aria-label={t`Group by`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t`No grouping`}</SelectItem>
            <SelectItem value="column">{t`Status`}</SelectItem>
            <SelectItem value="assignee">{t`Assignee`}</SelectItem>
            <SelectItem value="priority">{t`Priority`}</SelectItem>
            <SelectItem value="label">{t`Label`}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {activeCount > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <Trans>Clear filters</Trans>
        </Button>
      )}
    </search>
  )
}

function ProjectFilters({
  projectId,
  labelId,
  assigneeId,
  onChange,
}: {
  readonly projectId: ProjectId
  readonly labelId: string | undefined
  readonly assigneeId: string | undefined
  readonly onChange: (patch: Partial<Record<keyof ListTasksQuery, unknown>>) => void
}) {
  const { t } = useLingui()
  const labels = useQuery(labelsQuery(projectId))
  const members = useQuery(membersQuery)
  return (
    <>
      <Select
        value={labelId ?? ALL}
        onValueChange={(value) => onChange({ labelId: value === ALL ? undefined : value })}
      >
        <SelectTrigger aria-label={t`Label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t`Any label`}</SelectItem>
          {(labels.data ?? []).map((label) => (
            <SelectItem key={label.id} value={label.id}>
              {label.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={assigneeId ?? ALL}
        onValueChange={(value) => onChange({ assigneeId: value === ALL ? undefined : value })}
      >
        <SelectTrigger aria-label={t`Assignee`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t`Anyone`}</SelectItem>
          {(members.data ?? []).map((member) => (
            <SelectItem key={member.userId} value={member.userId}>
              {member.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}

function DueDateInput({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string | undefined
  readonly onChange: (value: string | undefined) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        className="w-40"
        value={value ?? ""}
        onChange={(event) => onChange(event.currentTarget.value || undefined)}
      />
    </div>
  )
}

function MentionsMeToggle({
  checked,
  onChange,
}: {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex h-8 items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="text-sm">
        <Trans>Mentions or assigned to me</Trans>
      </Label>
    </div>
  )
}
