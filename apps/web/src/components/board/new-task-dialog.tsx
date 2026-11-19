import { useLingui } from "@lingui/react/macro"
import { useState, type FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@audit/ui/components/ui/dialog.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"

export interface NewTaskColumn {
  readonly id: string
  readonly name: string
}

export interface NewTaskDialogProps {
  readonly open: boolean
  readonly columns: ReadonlyArray<NewTaskColumn>
  readonly onOpenChange: (open: boolean) => void
  readonly onCreate: (title: string, columnId: string) => void
}

/** Opened by the `new=task` request: a title and a column, created through the board's mutation. */
export function NewTaskDialog({ open, columns, onOpenChange, onCreate }: NewTaskDialogProps) {
  const { t } = useLingui()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t`New task`}</DialogTitle>
        </DialogHeader>
        {open && columns.length > 0 && (
          <NewTaskForm
            columns={columns}
            onCancel={() => onOpenChange(false)}
            onCreate={(title, columnId) => {
              onCreate(title, columnId)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewTaskForm({
  columns,
  onCancel,
  onCreate,
}: {
  readonly columns: ReadonlyArray<NewTaskColumn>
  readonly onCancel: () => void
  readonly onCreate: (title: string, columnId: string) => void
}) {
  const { t } = useLingui()
  const [title, setTitle] = useState("")
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "")

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (trimmed === "") return
    onCreate(trimmed, columnId)
  }

  return (
    <form id="new-task-form" className="grid gap-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="new-task-title">
          <span>{t`Task title`}</span>
        </Label>
        <Input
          id="new-task-title"
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-task-column">
          <span>{t`Column`}</span>
        </Label>
        <Select value={columnId} onValueChange={(value) => value !== null && setColumnId(value)}>
          <SelectTrigger id="new-task-column" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {columns.map((column) => (
              <SelectItem key={column.id} value={column.id}>
                {column.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t`Cancel`}
        </Button>
        <Button type="submit" disabled={title.trim() === ""}>
          {t`Create task`}
        </Button>
      </DialogFooter>
    </form>
  )
}
