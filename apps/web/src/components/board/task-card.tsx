import { useState } from "react"
import { useLingui } from "@lingui/react/macro"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Member } from "@audit/domain/identity/schema"
import type { Label } from "@audit/domain/projects/schema"
import type { TaskCard as TaskCardModel } from "@audit/domain/tasks/schema"
import { Avatar, AvatarFallback } from "@audit/ui/components/ui/avatar.tsx"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Checkbox } from "@audit/ui/components/ui/checkbox.tsx"
import { EntityActionsButton, EntityContextMenu } from "../actions/entity-menu.tsx"
import type { MoveColumn } from "../actions/types.ts"
import { cardDomId } from "./board-model.ts"
import { usePriorityLabels } from "./hooks.ts"

export const initials = (name: string) =>
  name
    .split(" ")
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()

export interface CardHandlers {
  readonly onToggle: (taskId: string) => void
  readonly onOpen: (card: TaskCardModel) => void
}

interface TaskCardBodyProps extends CardHandlers {
  readonly card: TaskCardModel
  readonly labels: ReadonlyMap<string, Label>
  readonly members: ReadonlyMap<string, Member>
  readonly selected: boolean
  /** Board columns for "Move to". Omit on the drag overlay to hide the actions button. */
  readonly columns?: ReadonlyArray<MoveColumn>
}

export function TaskCardBody({
  card,
  labels,
  members,
  selected,
  columns,
  onToggle,
  onOpen,
}: TaskCardBodyProps) {
  const { t, i18n } = useLingui()
  const [now] = useState(() => Date.now())
  const priorityLabels = usePriorityLabels()
  const overdue =
    card.dueAt !== null &&
    card.dueAt.getTime() < now &&
    card.columnCategory !== "done" &&
    card.columnCategory !== "canceled"

  return (
    <div className="group bg-card text-card-foreground relative flex flex-col gap-2 rounded-lg border p-3 text-sm shadow-xs">
      <div className="flex items-center gap-2">
        <span
          className="relative z-10"
          role="presentation"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(card.id)}
            aria-label={t`Select ${card.key}`}
          />
        </span>
        <span className="text-muted-foreground font-mono text-xs">{card.key}</span>
        <span className="ms-auto flex items-center gap-1">
          {card.priority === "none" ? null : (
            <Badge variant="outline">{priorityLabels[card.priority]}</Badge>
          )}
          {columns === undefined ? null : (
            <span
              className="relative z-10 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
              role="presentation"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <EntityActionsButton
                target={{ kind: "task", task: card, columns }}
                label={t`Actions for ${card.key}`}
              />
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onOpen(card)}
        className="rounded-sm text-left font-medium break-words after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {card.title}
      </button>
      {card.labels.length === 0 ? null : (
        <div className="flex flex-wrap gap-1">
          {card.labels.map((labelId) => {
            const label = labels.get(labelId)
            if (label === undefined) return null
            return (
              <span
                key={label.id}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </span>
            )
          })}
        </div>
      )}
      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        {card.dueAt === null ? null : (
          <span className={overdue ? "text-destructive font-medium" : undefined}>
            {new Intl.DateTimeFormat(i18n.locale, { month: "short", day: "numeric" }).format(
              card.dueAt,
            )}
          </span>
        )}
        {card.subtaskCount === 0 ? null : (
          <span aria-label={t`${card.subtasksDone} of ${card.subtaskCount} subtasks done`}>
            {card.subtasksDone}/{card.subtaskCount}
          </span>
        )}
        {card.commentCount === 0 ? null : (
          <span aria-label={t`${card.commentCount} comments`}>{card.commentCount}</span>
        )}
        <span className="ml-auto flex -space-x-2">
          {card.assignees.map((userId) => {
            const name = members.get(userId)?.displayName ?? userId
            return (
              <Avatar key={userId} title={name}>
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
            )
          })}
        </span>
      </div>
    </div>
  )
}

interface SortableTaskCardProps extends TaskCardBodyProps {
  readonly columnId: string
  readonly reduced: boolean
  readonly onFocus: (taskId: string) => void
}

export function SortableTaskCard({ columnId, reduced, onFocus, ...body }: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: body.card.id,
    data: { type: "task", columnId },
  })

  return (
    <EntityContextMenu target={{ kind: "task", task: body.card, columns: body.columns }}>
      <div
        ref={setNodeRef}
        id={cardDomId(body.card.id)}
        onFocus={() => onFocus(body.card.id)}
        style={{
          transform: CSS.Transform.toString(transform),
          transition: reduced ? undefined : transition,
        }}
        className={
          isDragging
            ? "opacity-40"
            : "rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        }
        {...attributes}
        {...listeners}
      >
        <TaskCardBody {...body} />
      </div>
    </EntityContextMenu>
  )
}
