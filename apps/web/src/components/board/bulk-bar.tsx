import { Plural, useLingui } from "@lingui/react/macro"
import { useState } from "react"
import type { BoardId, ColumnId, LabelId, TaskId, UserId } from "@audit/domain/ids"
import type { Label } from "@audit/domain/projects/schema"
import type { Member } from "@audit/domain/identity/schema"
import type { BoardView } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { useBulkAction, type BulkAction } from "./board-mutations.ts"

export interface BulkBarProps {
  readonly boardId: BoardId
  readonly taskIds: ReadonlyArray<TaskId>
  readonly columns: BoardView["columns"]
  readonly labels: ReadonlyArray<Label>
  readonly members: ReadonlyArray<Member>
  readonly onDone: () => void
}

export function BulkBar({ boardId, taskIds, columns, labels, members, onDone }: BulkBarProps) {
  const { t } = useLingui()
  const bulk = useBulkAction(boardId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const run = (action: BulkAction) => bulk.mutate(action, { onSuccess: onDone })

  return (
    <section
      aria-label={t`Bulk actions`}
      className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"
    >
      <span className="font-medium">
        <Plural value={taskIds.length} one="# task selected" other="# tasks selected" />
      </span>
      <Select
        value=""
        onValueChange={(columnId) => run({ _tag: "move", taskIds, columnId: columnId as ColumnId })}
      >
        <SelectTrigger aria-label={t`Move selected to column`} className="w-44">
          <SelectValue placeholder={t`Move to column`} />
        </SelectTrigger>
        <SelectContent>
          {columns.map((column) => (
            <SelectItem key={column.id} value={column.id}>
              {column.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value=""
        onValueChange={(userId) => run({ _tag: "assign", taskIds, add: [userId as UserId] })}
      >
        <SelectTrigger aria-label={t`Assign selected to`} className="w-44">
          <SelectValue placeholder={t`Assign to`} />
        </SelectTrigger>
        <SelectContent>
          {members.map((member) => (
            <SelectItem key={member.userId} value={member.userId}>
              {member.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value=""
        onValueChange={(labelId) => run({ _tag: "label", taskIds, add: [labelId as LabelId] })}
      >
        <SelectTrigger aria-label={t`Add label to selected`} className="w-44">
          <SelectValue placeholder={t`Add label`} />
        </SelectTrigger>
        <SelectContent>
          {labels.map((label) => (
            <SelectItem key={label.id} value={label.id}>
              {label.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
        {t`Delete`}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDone} className="ml-auto">
        {t`Clear selection`}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t`Delete selected tasks?`}</DialogTitle>
            <DialogDescription>
              <Plural
                value={taskIds.length}
                one="This deletes # task. This cannot be undone."
                other="This deletes # tasks. This cannot be undone."
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t`Cancel`}
            </Button>
            <Button
              variant="destructive"
              disabled={bulk.isPending}
              onClick={() => {
                setConfirmOpen(false)
                run({ _tag: "delete", taskIds })
              }}
            >
              {t`Delete`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
