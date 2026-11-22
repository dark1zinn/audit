import { useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Tag } from "lucide-react"
import type { ProjectId } from "@audit/domain/ids"
import type { Priority, TaskDetail, UpdateTaskInput } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { ScrollArea } from "@audit/ui/components/ui/scroll-area.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { callApi } from "../../lib/api.ts"
import { EmptyState, ErrorMessage } from "../feedback.tsx"
import { fieldWidth } from "../form.tsx"
import { labelsQuery, membersQuery } from "../../lib/queries.ts"
import { fromDayString, toDayString } from "./dates.ts"

interface TaskFieldsProps {
  readonly task: TaskDetail
  readonly projectId: ProjectId
  readonly canEdit: boolean
  readonly pending: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}

export function TaskFields({ task, projectId, canEdit, pending, onSave }: TaskFieldsProps) {
  return (
    <div className="space-y-6">
      <PriorityField task={task} canEdit={canEdit} onSave={onSave} />
      <DatesFields task={task} canEdit={canEdit} onSave={onSave} />
      <EstimateField key={task.version} task={task} canEdit={canEdit} onSave={onSave} />
      <AssigneesField task={task} canEdit={canEdit} disabled={pending} onSave={onSave} />
      <LabelsField
        task={task}
        projectId={projectId}
        canEdit={canEdit}
        disabled={pending}
        onSave={onSave}
      />
    </div>
  )
}

function PriorityField({
  task,
  canEdit,
  onSave,
}: {
  readonly task: TaskDetail
  readonly canEdit: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}) {
  const { t } = useLingui()
  const options: ReadonlyArray<{ readonly value: Priority; readonly label: string }> = [
    { value: "none", label: t`No priority` },
    { value: "low", label: t`Low` },
    { value: "medium", label: t`Medium` },
    { value: "high", label: t`High` },
    { value: "urgent", label: t`Urgent` },
  ]
  return (
    <div className="space-y-2">
      <Label htmlFor="task-priority">{t`Priority`}</Label>
      <Select
        value={task.priority}
        disabled={!canEdit}
        onValueChange={(value) => onSave({ priority: value as Priority })}
      >
        <SelectTrigger id="task-priority" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function DatesFields({
  task,
  canEdit,
  onSave,
}: {
  readonly task: TaskDetail
  readonly canEdit: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}) {
  const { t } = useLingui()
  return (
    <div className="grid gap-3">
      <div className="space-y-2">
        <Label htmlFor="task-start">{t`Start date`}</Label>
        <Input
          id="task-start"
          type="date"
          disabled={!canEdit}
          value={task.startAt === null ? "" : toDayString(task.startAt)}
          onChange={(event) =>
            onSave({
              startAt: event.target.value === "" ? null : fromDayString(event.target.value),
            })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="task-due">{t`Due date`}</Label>
        <Input
          id="task-due"
          type="date"
          disabled={!canEdit}
          value={task.dueAt === null ? "" : toDayString(task.dueAt)}
          onChange={(event) =>
            onSave({ dueAt: event.target.value === "" ? null : fromDayString(event.target.value) })
          }
        />
      </div>
    </div>
  )
}

/** Keyed by task version so the draft resets whenever the server copy changes. */
function EstimateField({
  task,
  canEdit,
  onSave,
}: {
  readonly task: TaskDetail
  readonly canEdit: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}) {
  const { t } = useLingui()
  const [draft, setDraft] = useState(task.estimate === null ? "" : String(task.estimate))
  const commit = () => {
    const next = draft.trim() === "" ? null : Number(draft)
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > 1000)) {
      setDraft(task.estimate === null ? "" : String(task.estimate))
      return
    }
    if (next !== task.estimate) onSave({ estimate: next })
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="task-estimate">{t`Estimate`}</Label>
      <Input
        id="task-estimate"
        type="number"
        min={0}
        max={1000}
        step={1}
        disabled={!canEdit}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
      />
    </div>
  )
}

function AssigneesField({
  task,
  canEdit,
  disabled,
  onSave,
}: {
  readonly task: TaskDetail
  readonly canEdit: boolean
  readonly disabled: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}) {
  const { t } = useLingui()
  const members = useQuery(membersQuery)
  if (members.isError) return <ErrorMessage error={members.error} />
  return (
    <fieldset className="space-y-2" disabled={!canEdit || disabled}>
      <legend className="mb-2 text-sm font-medium">{t`Assignees`}</legend>
      <ScrollArea className="h-40 rounded-md border p-2">
        <div className="space-y-2">
          {(members.data ?? []).map((member) => {
            const checked = task.assignees.includes(member.userId)
            return (
              <div key={member.userId} className="flex items-center gap-2">
                <Checkbox
                  id={`assignee-${member.userId}`}
                  checked={checked}
                  onCheckedChange={(next) => {
                    const assignees =
                      next === true
                        ? [...task.assignees, member.userId]
                        : task.assignees.filter((id) => id !== member.userId)
                    onSave({ assignees })
                  }}
                />
                <Label htmlFor={`assignee-${member.userId}`} className="font-normal">
                  {member.displayName}
                </Label>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </fieldset>
  )
}

function LabelsField({
  task,
  projectId,
  canEdit,
  disabled,
  onSave,
}: {
  readonly task: TaskDetail
  readonly projectId: ProjectId
  readonly canEdit: boolean
  readonly disabled: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const labels = useQuery(labelsQuery(projectId))
  const [name, setName] = useState("")
  const [color, setColor] = useState("#6366f1")
  const [open, setOpen] = useState(false)

  const createLabel = useMutation({
    mutationFn: (input: { readonly name: string; readonly color: string }) =>
      callApi((api) =>
        api.boards.createLabel({
          params: { projectId },
          payload: { name: input.name, color: input.color },
        }),
      ),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: labelsQuery(projectId).queryKey })
      setName("")
      onSave({ labels: [...task.labels, created.id] })
    },
  })

  if (labels.isError) return <ErrorMessage error={labels.error} />
  const assigned = (labels.data ?? []).filter((label) => task.labels.includes(label.id))
  return (
    <fieldset className="space-y-3" disabled={!canEdit || disabled}>
      <legend className="mb-2 text-sm font-medium">{t`Labels`}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {assigned.length === 0 ? (
          <EmptyState size="sm" icon={Tag} title={t`No labels yet.`} />
        ) : (
          <ul aria-label={t`Assigned labels`} className="flex flex-wrap gap-1.5">
            {assigned.map((label) => (
              <li
                key={label.id}
                className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ms-auto"
            aria-expanded={open}
            aria-controls="task-labels-editor"
            onClick={() => setOpen((value) => !value)}
          >
            {t`Add label`}
          </Button>
        )}
      </div>
      {open && (
        <div id="task-labels-editor" className="space-y-3">
          <ScrollArea className="h-32 rounded-md border p-2">
            <div className="space-y-2">
              {(labels.data ?? []).map((label) => {
                const checked = task.labels.includes(label.id)
                return (
                  <div key={label.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`label-${label.id}`}
                      checked={checked}
                      onCheckedChange={(next) => {
                        const labelIds =
                          next === true
                            ? [...task.labels, label.id]
                            : task.labels.filter((id) => id !== label.id)
                        onSave({ labels: labelIds })
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <Label htmlFor={`label-${label.id}`} className="font-normal">
                      {label.name}
                    </Label>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
          {canEdit && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const trimmed = name.trim()
                if (trimmed.length === 0) return
                createLabel.mutate({ name: trimmed, color })
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="new-label-name">{t`New label`}</Label>
                <Input
                  id="new-label-name"
                  className={fieldWidth.md}
                  value={name}
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-label-color">{t`Label color`}</Label>
                <Input
                  id="new-label-color"
                  type="color"
                  className="h-9 w-12 p-1"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" disabled={createLabel.isPending}>
                {t`Create label`}
              </Button>
            </form>
          )}
        </div>
      )}
    </fieldset>
  )
}
