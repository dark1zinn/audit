import { useLingui } from "@lingui/react/macro"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { useDroppable } from "@dnd-kit/core"
import type { Member } from "@audit/domain/identity/schema"
import type { Label } from "@audit/domain/projects/schema"
import type { BoardView, TaskCard as TaskCardModel } from "@audit/domain/tasks/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import type { MoveColumn } from "../actions/types.ts"
import { columnDropId } from "./board-model.ts"
import { SortableTaskCard, type CardHandlers } from "./task-card.tsx"

type BoardColumnModel = BoardView["columns"][number]

export interface BoardColumnProps extends CardHandlers {
  readonly column: BoardColumnModel
  readonly columns: ReadonlyArray<MoveColumn>
  readonly cards: ReadonlyArray<TaskCardModel>
  readonly labels: ReadonlyMap<string, Label>
  readonly members: ReadonlyMap<string, Member>
  readonly selected: ReadonlySet<string>
  readonly reduced: boolean
  readonly onFocus: (taskId: string) => void
  readonly onQuickAdd: (title: string) => void
}

export function BoardColumn({
  column,
  columns,
  cards,
  labels,
  members,
  selected,
  reduced,
  onFocus,
  onQuickAdd,
  onToggle,
  onOpen,
}: BoardColumnProps) {
  const { t } = useLingui()
  const { setNodeRef, isOver } = useDroppable({
    id: columnDropId(column.id),
    data: { type: "column", columnId: column.id },
  })

  return (
    <section
      aria-label={column.name}
      className="bg-muted/40 flex min-h-0 w-72 shrink-0 flex-col gap-2 rounded-xl p-2"
    >
      <header className="flex items-center gap-2 px-1">
        <h2 className="truncate text-sm font-semibold">{column.name}</h2>
        <span className="text-muted-foreground text-xs">
          {column.wipLimit === null ? cards.length : `${cards.length}/${column.wipLimit}`}
        </span>
        {column.overWipLimit ? (
          <Badge variant="destructive" className="ml-auto">
            {t`Over WIP limit`}
          </Badge>
        ) : null}
      </header>
      <div
        ref={setNodeRef}
        className={
          isOver
            ? "ring-ring -m-1 flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-1 ring-2"
            : "-m-1 flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-1"
        }
      >
        <SortableContext
          items={cards.map((card) => card.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <SortableTaskCard
              key={card.id}
              card={card}
              columns={columns}
              columnId={column.id}
              labels={labels}
              members={members}
              selected={selected.has(card.id)}
              reduced={reduced}
              onFocus={onFocus}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>
      </div>
      <QuickAdd columnId={column.id} columnName={column.name} onAdd={onQuickAdd} />
    </section>
  )
}

interface QuickAddProps {
  readonly columnId: string
  readonly columnName: string
  readonly onAdd: (title: string) => void
}

function QuickAdd({ columnId, columnName, onAdd }: QuickAddProps) {
  const { t } = useLingui()

  return (
    <form
      className="shrink-0"
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const field = form.elements.namedItem("title")
        const title = field instanceof HTMLInputElement ? field.value.trim() : ""
        if (title.length === 0) return
        onAdd(title)
        form.reset()
      }}
    >
      <Input
        id={`quick-add-${columnId}`}
        name="title"
        maxLength={300}
        placeholder={t`Add a task`}
        aria-label={t`Add a task to ${columnName}`}
        autoComplete="off"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur()
        }}
      />
    </form>
  )
}
