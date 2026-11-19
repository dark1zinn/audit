import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trans, useLingui } from "@lingui/react/macro"
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core"
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react"
import type { DocNode } from "@audit/domain/docs/schema"
import type { DocId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import { callApi } from "../../lib/api.ts"
import { ErrorMessage } from "../feedback.tsx"
import {
  buildTree,
  moveDown,
  moveFor,
  moveUp,
  visibleRows,
  type DropPlacement,
  type MoveTarget,
  type TreeNode,
} from "./tree.ts"
import { docKeys } from "./queries.ts"

interface DocTreeProps {
  readonly docs: ReadonlyArray<DocNode>
  readonly activeDocId: DocId | null
  /** Route for a doc, so the tree works in both the space and project areas. */
  readonly hrefFor: (docId: DocId) => string
  readonly onMoved?: () => void
}

/** Lists docs as an indented tree. Drag to reorder or nest; each row also has keyboard moves. */
export const DocTree = ({ docs, activeDocId, hrefFor, onMoved }: DocTreeProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<unknown>(null)
  const [announcement, setAnnouncement] = useState("")
  const rows = visibleRows(buildTree(docs), collapsed)

  const move = useMutation({
    mutationFn: ({ docId, target }: { docId: DocId; target: MoveTarget }) =>
      callApi((api) => api.docs.move({ params: { docId }, payload: target })),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ["docs"] })
      onMoved?.()
    },
    onError: (failure) => setError(failure),
  })

  const apply = (docId: DocId, target: MoveTarget | undefined, message: string) => {
    if (target === undefined) return
    setAnnouncement(message)
    move.mutate({ docId, target })
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    const activeRect = active.rect.current.translated ?? active.rect.current.initial
    if (activeRect === null) return
    const pointer = activeRect.top + activeRect.height / 2
    const ratio = (pointer - over.rect.top) / over.rect.height
    const placement: DropPlacement = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside"
    const docId = String(active.id) as DocId
    const targetId = String(over.id) as DocId
    const target = moveFor(docs, docId, targetId, placement)
    apply(docId, target, t`Moved document.`)
  }

  return (
    <div>
      {error !== null && <ErrorMessage error={error} />}
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>
      <DndContext
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => t`Picked up ${String(active.id)}.`,
            onDragOver: ({ over }) =>
              over === null ? t`No longer over a drop target.` : t`Over a drop target.`,
            onDragEnd: ({ over }) => (over === null ? t`Drop cancelled.` : t`Dropped.`),
            onDragCancel: () => t`Drag cancelled.`,
          },
        }}
      >
        <ul role="tree" aria-label={t`Documents`} className="space-y-0.5">
          {rows.map((node) => (
            <TreeRow
              key={node.doc.id}
              node={node}
              expanded={!collapsed.has(node.doc.id) && node.children.length > 0}
              active={node.doc.id === activeDocId}
              href={hrefFor(node.doc.id as DocId)}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current)
                  if (next.has(node.doc.id)) next.delete(node.doc.id)
                  else next.add(node.doc.id)
                  return next
                })
              }
              menu={
                <RowMenu
                  docs={docs}
                  doc={node.doc}
                  onMove={(target, message) => apply(node.doc.id as DocId, target, message)}
                />
              }
            />
          ))}
        </ul>
      </DndContext>
    </div>
  )
}

interface TreeRowProps {
  readonly node: TreeNode
  readonly expanded: boolean
  readonly active: boolean
  readonly href: string
  readonly onToggle: () => void
  readonly menu: React.ReactNode
}

const TreeRow = ({ node, expanded, active, href, onToggle, menu }: TreeRowProps) => {
  const { t } = useLingui()
  const { doc } = node
  const drag = useDraggable({ id: doc.id })
  const drop = useDroppable({ id: doc.id })
  const hasChildren = node.children.length > 0
  return (
    <li
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={active}
      className="relative"
    >
      <div
        ref={(element) => {
          drag.setNodeRef(element)
          drop.setNodeRef(element)
        }}
        style={{ paddingLeft: node.depth * 12 }}
        className={`group flex items-center gap-1 rounded-md pr-1 ${
          drop.isOver ? "ring-primary ring-1" : ""
        } ${active ? "bg-accent" : "hover:bg-accent/60"} ${drag.isDragging ? "opacity-50" : ""}`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? t`Collapse` : t`Expand`}
            onClick={onToggle}
            className="text-muted-foreground focus-visible:ring-ring rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="inline-block w-4" aria-hidden="true" />
        )}
        <Link
          to={href}
          className="focus-visible:ring-ring min-w-0 flex-1 truncate rounded px-1 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
          {...drag.listeners}
          {...drag.attributes}
          aria-roledescription={t`draggable document`}
        >
          {doc.icon !== null && <span aria-hidden="true">{doc.icon} </span>}
          {doc.title || t`Untitled`}
        </Link>
        {menu}
      </div>
    </li>
  )
}

const RowMenu = ({
  docs,
  doc,
  onMove,
}: {
  readonly docs: ReadonlyArray<DocNode>
  readonly doc: DocNode
  readonly onMove: (target: MoveTarget | undefined, message: string) => void
}) => {
  const { t } = useLingui()
  const siblings = docs
    .filter((candidate) => candidate.parentId === doc.parentId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
  const index = siblings.findIndex((candidate) => candidate.id === doc.id)
  const previous = index > 0 ? siblings[index - 1] : undefined
  const parent = docs.find((candidate) => candidate.id === doc.parentId)
  const moveOut =
    parent === undefined ? undefined : ({ parentId: parent.parentId, afterId: parent.id } as const)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 opacity-70 focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={t`Move ${doc.title || t`Untitled`}`}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={index <= 0}
          onSelect={() => onMove(moveUp(docs, doc.id as DocId), t`Moved up.`)}
        >
          <Trans>Move up</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index < 0 || index >= siblings.length - 1}
          onSelect={() => onMove(moveDown(docs, doc.id as DocId), t`Moved down.`)}
        >
          <Trans>Move down</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={previous === undefined}
          onSelect={() =>
            previous !== undefined &&
            onMove(moveFor(docs, doc.id as DocId, previous.id as DocId, "inside"), t`Nested.`)
          }
        >
          <Trans>Nest under previous</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={moveOut === undefined}
          onSelect={() => onMove(moveOut, t`Moved out.`)}
        >
          <Trans>Move out</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { docKeys }
