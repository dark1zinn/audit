import { useLingui } from "@lingui/react/macro"
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { useMemo, useRef, useState } from "react"
import type { Member } from "@audit/domain/identity/schema"
import type { Label } from "@audit/domain/projects/schema"
import type {
  BoardView as BoardViewModel,
  TaskCard as TaskCardModel,
} from "@audit/domain/tasks/schema"
import {
  columnFromDrop,
  findTask,
  isColumnDrop,
  lanesOf,
  locate,
  moveInLanes,
  planMove,
  type Lanes,
  type MoveRequest,
} from "./board-model.ts"
import { BoardColumn } from "./board-column.tsx"
import { TaskCardBody } from "./task-card.tsx"

export interface BoardViewProps {
  readonly view: BoardViewModel
  readonly labels: ReadonlyMap<string, Label>
  readonly members: ReadonlyMap<string, Member>
  readonly selected: ReadonlySet<string>
  readonly reduced: boolean
  readonly onToggle: (taskId: string) => void
  readonly onOpen: (card: TaskCardModel) => void
  readonly onFocus: (taskId: string) => void
  readonly onMove: (request: MoveRequest) => void
  readonly onQuickAdd: (columnId: string, title: string) => void
}

export function BoardView({
  view,
  labels,
  members,
  selected,
  reduced,
  onToggle,
  onOpen,
  onFocus,
  onMove,
  onQuickAdd,
}: BoardViewProps) {
  const { t } = useLingui()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const lanes = useMemo(() => lanesOf(view), [view])
  const tasksById = useMemo(
    () =>
      new Map<string, TaskCardModel>(
        view.columns.flatMap((column) => column.tasks).map((task) => [task.id, task]),
      ),
    [view],
  )

  const [preview, setPreview] = useState<Lanes | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const previewRef = useRef<Lanes | null>(null)
  const originRef = useRef<{ readonly column: string; readonly index: number } | null>(null)
  const current = preview ?? lanes

  const updatePreview = (next: Lanes | null) => {
    previewRef.current = next
    setPreview(next)
  }

  const columnName = (columnId: string | undefined) =>
    view.columns.find((column) => column.id === columnId)?.name ?? ""
  const columnOfDropId = (id: string) => (isColumnDrop(id) ? columnFromDrop(id) : locate(lanes, id))
  const keyOf = (active: Active) => tasksById.get(String(active.id))?.key ?? ""

  const announcements = {
    onDragStart: ({ active }: DragStartEvent) =>
      t`Picked up ${keyOf(active)} in ${columnName(columnOfDropId(String(active.id)))}.`,
    onDragOver: ({ active, over }: DragOverEvent) =>
      over === null
        ? t`${keyOf(active)} is no longer over a column.`
        : t`${keyOf(active)} is over ${columnName(columnOfDropId(String(over.id)))}.`,
    onDragEnd: ({ active, over }: DragEndEvent) =>
      over === null
        ? t`${keyOf(active)} was dropped without moving.`
        : t`${keyOf(active)} was dropped in ${columnName(columnOfDropId(String(over.id)))}.`,
    onDragCancel: ({ active }: { readonly active: Active }) =>
      t`Moving ${keyOf(active)} was cancelled.`,
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id)
    const column = locate(lanes, id)
    if (column !== undefined) {
      originRef.current = { column, index: (lanes[column] ?? []).indexOf(id) }
    }
    setActiveId(id)
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (over === null) return
    const base = previewRef.current ?? lanes
    const id = String(active.id)
    const from = locate(base, id)
    const overColumn = isColumnDrop(over.id)
      ? columnFromDrop(over.id)
      : locate(base, String(over.id))
    if (from === undefined || overColumn === undefined || from === overColumn) return
    const overTask = isColumnDrop(over.id) ? null : String(over.id)
    updatePreview(moveInLanes(base, id, overColumn, overTask))
  }

  const reset = () => {
    setActiveId(null)
    originRef.current = null
    updatePreview(null)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id)
    const base = previewRef.current ?? lanes
    const column = locate(base, id)
    const origin = originRef.current
    let final = base
    if (column !== undefined && over !== null && !isColumnDrop(over.id)) {
      const overId = String(over.id)
      const list = base[column] ?? []
      if (overId !== id && list.includes(overId)) {
        final = { ...base, [column]: arrayMove([...list], list.indexOf(id), list.indexOf(overId)) }
      }
    }
    reset()
    if (column === undefined) return
    const index = (final[column] ?? []).indexOf(id)
    if (origin !== null && origin.column === column && origin.index === index) return
    const request = planMove(view, final, id, column)
    if (request !== undefined) onMove(request)
  }

  const activeTask = activeId === null ? undefined : findTask(view, activeId)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t`To move a task, press space or enter, use the arrow keys to choose a position, then press space or enter to drop. Press escape to cancel.`,
        },
      }}
    >
      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {view.columns.map((column) => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={(current[column.id] ?? []).flatMap((id) => {
              const task = tasksById.get(id)
              return task === undefined ? [] : [task]
            })}
            labels={labels}
            members={members}
            selected={selected}
            reduced={reduced}
            onFocus={onFocus}
            onToggle={onToggle}
            onOpen={onOpen}
            onQuickAdd={(title) => onQuickAdd(column.id, title)}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={reduced ? null : undefined}>
        {activeTask === undefined ? null : (
          <TaskCardBody
            card={activeTask}
            labels={labels}
            members={members}
            selected={selected.has(activeTask.id)}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}
