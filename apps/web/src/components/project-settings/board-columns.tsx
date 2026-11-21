import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import type { ColumnId } from "@audit/domain/ids"
import type { Board, BoardColumn, ColumnCategory } from "@audit/domain/projects/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { callApi } from "../../lib/api.ts"
import { ErrorMessage } from "../feedback.tsx"
import { fieldWidth, TextField } from "../form.tsx"
import { invalidateBoards } from "./invalidate.ts"
import { columnCategories, useSettingsLabels } from "./options.ts"

const parseWipLimit = (value: string): number | null => (value.trim() === "" ? null : Number(value))

export function BoardColumns({ board }: { readonly board: Board }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const labels = useSettingsLabels()
  const [name, setName] = useState("")
  const [category, setCategory] = useState<ColumnCategory>("todo")
  const [wipLimit, setWipLimit] = useState("")
  const refresh = () => invalidateBoards(queryClient, board.projectId, board.id)

  const create = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.boards.createColumn({
          params: { boardId: board.id },
          payload: { name: name.trim(), category, wipLimit: parseWipLimit(wipLimit) },
        }),
      ),
    onSuccess: async () => {
      setName("")
      setWipLimit("")
      await refresh()
    },
  })

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    create.mutate()
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">
        <Trans>Columns</Trans>
      </h3>
      <Table className="max-sm:block">
        <TableHeader className="max-sm:hidden">
          <TableRow>
            <TableHead>
              <Trans>Column</Trans>
            </TableHead>
            <TableHead>
              <Trans>Category</Trans>
            </TableHead>
            <TableHead>
              <Trans>WIP limit</Trans>
            </TableHead>
            <TableHead>
              <Trans>Tasks</Trans>
            </TableHead>
            <TableHead>
              <span className="sr-only">
                <Trans>Actions</Trans>
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="max-sm:block">
          {board.columns.map((column, index) => (
            <ColumnRow
              key={`${column.id}:${column.name}:${column.category}:${column.wipLimit}:${column.taskCount}`}
              column={column}
              columns={board.columns}
              index={index}
              onChanged={refresh}
            />
          ))}
        </TableBody>
      </Table>

      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        onSubmit={onCreate}
      >
        <TextField
          name={`column-name-${board.id}`}
          width="md"
          label={t`New column name`}
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="space-y-2">
          <Label htmlFor={`column-category-${board.id}`}>
            <Trans>Category</Trans>
          </Label>
          <Select value={category} onValueChange={(value) => setCategory(value as ColumnCategory)}>
            <SelectTrigger id={`column-category-${board.id}`} className={fieldWidth.xs}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columnCategories.map((columnCategory) => (
                <SelectItem key={columnCategory} value={columnCategory}>
                  {labels.category[columnCategory]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TextField
          name={`column-wip-${board.id}`}
          label={t`WIP limit`}
          type="number"
          min={1}
          max={999}
          width="xs"
          value={wipLimit}
          onChange={(event) => setWipLimit(event.target.value)}
        />
        <Button type="submit" disabled={create.isPending || name.trim().length === 0}>
          <Trans>Add column</Trans>
        </Button>
      </form>
      {create.error !== null && <ErrorMessage error={create.error} />}
    </div>
  )
}

function ColumnRow({
  column,
  columns,
  index,
  onChanged,
}: {
  readonly column: BoardColumn
  readonly columns: ReadonlyArray<BoardColumn>
  readonly index: number
  readonly onChanged: () => Promise<void>
}) {
  const { t } = useLingui()
  const labels = useSettingsLabels()
  const [name, setName] = useState(column.name)
  const [category, setCategory] = useState<ColumnCategory>(column.category)
  const [wipLimit, setWipLimit] = useState(column.wipLimit === null ? "" : String(column.wipLimit))
  const others = columns.filter((other) => other.id !== column.id)
  const [moveTasksTo, setMoveTasksTo] = useState<ColumnId | null>(others[0]?.id ?? null)

  const update = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.boards.updateColumn({
          params: { columnId: column.id },
          payload: { name: name.trim(), category, wipLimit: parseWipLimit(wipLimit) },
        }),
      ),
    onSuccess: onChanged,
  })

  const move = useMutation({
    mutationFn: (afterColumnId: ColumnId | null) =>
      callApi((api) =>
        api.boards.moveColumn({ params: { columnId: column.id }, payload: { afterColumnId } }),
      ),
    onSuccess: onChanged,
  })

  const remove = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.boards.deleteColumn({
          params: { columnId: column.id },
          payload: { moveTasksTo: column.taskCount > 0 ? moveTasksTo : null },
        }),
      ),
    onSuccess: onChanged,
  })

  const error = update.error ?? move.error ?? remove.error
  const busy = update.isPending || move.isPending || remove.isPending
  const cannotDelete = column.taskCount > 0 && moveTasksTo === null

  return (
    <>
      <TableRow className="max-sm:block max-sm:border-b max-sm:py-2">
        <TableCell className="max-sm:block max-sm:whitespace-normal max-sm:px-3 max-sm:pt-1">
          <Input
            className="max-sm:h-11"
            aria-label={t`Column name`}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="block text-xs text-muted-foreground sm:hidden">
            {t`${column.taskCount} tasks`}
          </span>
        </TableCell>
        <TableCell className="max-sm:block max-sm:px-3 max-sm:py-1">
          <Select value={category} onValueChange={(value) => setCategory(value as ColumnCategory)}>
            <SelectTrigger aria-label={t`Category`} className={`${fieldWidth.xs} max-sm:h-11`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columnCategories.map((columnCategory) => (
                <SelectItem key={columnCategory} value={columnCategory}>
                  {labels.category[columnCategory]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="max-sm:block max-sm:px-3 max-sm:py-1">
          <Input
            aria-label={t`WIP limit`}
            type="number"
            min={1}
            max={999}
            className={`${fieldWidth["2xs"]} max-sm:h-11`}
            placeholder={t`None`}
            value={wipLimit}
            onChange={(event) => setWipLimit(event.target.value)}
          />
        </TableCell>
        <TableCell className="hidden sm:table-cell">{column.taskCount}</TableCell>
        <TableCell className="max-sm:block max-sm:px-3 max-sm:py-1">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:h-11"
              disabled={busy || index === 0}
              aria-label={t`Move ${column.name} up`}
              onClick={() => move.mutate(columns[index - 2]?.id ?? null)}
            >
              <Trans>Up</Trans>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:h-11"
              disabled={busy || index === columns.length - 1}
              aria-label={t`Move ${column.name} down`}
              onClick={() => {
                const after = columns[index + 1]
                if (after !== undefined) move.mutate(after.id)
              }}
            >
              <Trans>Down</Trans>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="max-sm:h-11"
              disabled={busy}
              onClick={() => update.mutate()}
            >
              <Trans>Save</Trans>
            </Button>
            {column.taskCount > 0 && (
              <Select
                value={moveTasksTo ?? ""}
                onValueChange={(value) => setMoveTasksTo(value as ColumnId)}
              >
                <SelectTrigger
                  aria-label={t`Move tasks to`}
                  className={`${fieldWidth.xs} max-sm:h-11`}
                >
                  <SelectValue placeholder={t`Move tasks to`} />
                </SelectTrigger>
                <SelectContent>
                  {others.map((other) => (
                    <SelectItem key={other.id} value={other.id}>
                      {other.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="max-sm:h-11"
              disabled={busy || cannotDelete}
              onClick={() => remove.mutate()}
            >
              <Trans>Delete</Trans>
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {error !== null && (
        <TableRow>
          <TableCell colSpan={5}>
            <ErrorMessage error={error} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
