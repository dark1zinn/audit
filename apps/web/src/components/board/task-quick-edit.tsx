import { useLingui } from "@lingui/react/macro"
import { useState } from "react"
import type { BoardId, LabelId, UserId } from "@audit/domain/ids"
import type { Label } from "@audit/domain/projects/schema"
import type { Member } from "@audit/domain/identity/schema"
import type { BoardView, TaskCard as TaskCardModel } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Label as FieldLabel } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { lanesOf, moveInLanes, planMove } from "./board-model.ts"
import { useMoveTask, useUpdateCard } from "./board-mutations.ts"

export type QuickEditMode = "assign" | "label" | "move"

export interface TaskQuickEditProps {
  readonly boardId: BoardId
  readonly mode: QuickEditMode
  readonly card: TaskCardModel
  readonly view: BoardView
  readonly labels: ReadonlyArray<Label>
  readonly members: ReadonlyArray<Member>
  readonly onClose: () => void
}

/**
 * Keyboard-reachable edit for one card. Mounted with `key` per card+mode so
 * its local selection state resets whenever the target changes.
 */
export function TaskQuickEdit(props: TaskQuickEditProps) {
  const { t } = useLingui()
  const { card, mode, onClose } = props
  const update = useUpdateCard(props.boardId)
  const move = useMoveTask(props.boardId)
  const [assignees, setAssignees] = useState<ReadonlyArray<UserId>>(card.assignees)
  const [labelIds, setLabelIds] = useState<ReadonlyArray<LabelId>>(card.labels)

  const toggle = <T extends string>(list: ReadonlyArray<T>, id: T) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id]

  const title =
    mode === "assign"
      ? t`Assign ${card.key}`
      : mode === "label"
        ? t`Labels for ${card.key}`
        : t`Move ${card.key}`

  const save = () => {
    const payload =
      mode === "assign"
        ? { taskId: card.id, version: card.version, assignees }
        : { taskId: card.id, version: card.version, labels: labelIds }
    update.mutate(payload, { onSuccess: onClose })
    onClose()
  }

  const moveTo = (columnId: string) => {
    const lanes = moveInLanes(lanesOf(props.view), card.id, columnId, null)
    const request = planMove(props.view, lanes, card.id, columnId)
    if (request !== undefined) move.mutate(request)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {mode === "move" ? (
          <Select value={card.columnId} onValueChange={moveTo}>
            <SelectTrigger aria-label={t`Target column`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.view.columns.map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : mode === "assign" ? (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {props.members.map((member) => (
              <li key={member.userId}>
                <FieldLabel className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={assignees.includes(member.userId)}
                    onCheckedChange={() =>
                      setAssignees((current) => toggle(current, member.userId))
                    }
                  />
                  {member.displayName}
                </FieldLabel>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {props.labels.map((label) => (
              <li key={label.id}>
                <FieldLabel className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={labelIds.includes(label.id)}
                    onCheckedChange={() => setLabelIds((current) => toggle(current, label.id))}
                  />
                  {label.name}
                </FieldLabel>
              </li>
            ))}
          </ul>
        )}
        {mode === "move" ? null : (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t`Cancel`}
            </Button>
            <Button onClick={save} disabled={update.isPending}>
              {t`Save`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
