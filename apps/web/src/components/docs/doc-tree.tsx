import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { callApi } from "../../lib/api.ts"
import { openTab } from "./doc-tabs.ts"
import { invalidateDoc } from "./queries.ts"
import { useLingui } from "@lingui/react/macro"
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { DocNode } from "@audit/domain/docs/schema"
import type { DocId } from "@audit/domain/ids"
import { EntityActionsButton, EntityContextMenu } from "../actions/entity-menu.tsx"
import { useMoveDoc } from "../actions/doc-actions.ts"
import type { EntityTarget } from "../actions/types.ts"
import { buildTree, moveFor, visibleRows, type DropPlacement, type TreeNode } from "./tree.ts"

interface DocTreeProps {
  readonly docs: ReadonlyArray<DocNode>
  readonly activeDocId: DocId | null
  /** Project key for doc links and menu actions; `undefined` in the workspace space. */
  readonly projectKey?: string | undefined
  /** Route for a doc, so the tree works in both the space and project areas. */
  readonly hrefFor: (docId: DocId) => string
  /** Opens a doc beside the current one (Shift+Enter, or the row's action menu). */
  readonly onOpenSide?: ((docId: DocId) => void) | undefined
}

/** Lists docs as an indented tree. Drag to reorder or nest; each row has a menu with the same actions. */
export const DocTree = ({ docs, activeDocId, projectKey, hrefFor, onOpenSide }: DocTreeProps) => {
  const { t } = useLingui()
  const move = useMoveDoc()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [announcement, setAnnouncement] = useState("")
  const rows = visibleRows(buildTree(docs), collapsed)

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
    const plan = moveFor(docs, docId, targetId, placement)
    if (plan === undefined) return
    setAnnouncement(t`Moved document.`)
    move(docId, plan, t`Moved document.`)
  }

  return (
    <div>
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
              projectKey={projectKey}
              onOpenSide={
                onOpenSide === undefined ? undefined : () => onOpenSide(node.doc.id as DocId)
              }
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current)
                  if (next.has(node.doc.id)) next.delete(node.doc.id)
                  else next.add(node.doc.id)
                  return next
                })
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
  readonly projectKey: string | undefined
  readonly onToggle: () => void
  readonly onOpenSide: (() => void) | undefined
}

const TreeRow = ({
  node,
  expanded,
  active,
  href,
  projectKey,
  onToggle,
  onOpenSide,
}: TreeRowProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { doc } = node
  const docId = doc.id as DocId
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(doc.title)
  const drag = useDraggable({ id: doc.id })
  const drop = useDroppable({ id: doc.id })
  const hasChildren = node.children.length > 0
  const rename = useMutation({
    mutationFn: (next: string) =>
      callApi((api) =>
        api.docs.rename({ params: { docId }, payload: { title: next, version: doc.version } }),
      ),
    onSuccess: () => {
      setRenaming(false)
      void invalidateDoc(queryClient, docId)
    },
    onError: () => toast.error(t`Could not rename the doc`),
  })
  const startRename = () => {
    setTitle(doc.title)
    setRenaming(true)
  }
  const commitRename = () => {
    const next = title.trim()
    if (next === "" || next === doc.title) return setRenaming(false)
    rename.mutate(next)
  }
  const target: EntityTarget = {
    kind: "doc",
    doc,
    projectKey,
    onRename: startRename,
    onOpenSide,
    onOpenTab: () => openTab({ id: docId, projectKey: projectKey ?? null }),
  }
  return (
    <li
      role="treeitem"
      aria-label={doc.title || t`Untitled`}
      aria-level={node.depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={active}
      className="relative"
    >
      <EntityContextMenu target={target}>
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
          {renaming ? (
            <Input
              ref={(element) => element?.focus()}
              aria-label={t`Rename document`}
              value={title}
              maxLength={200}
              disabled={rename.isPending}
              className="h-7 min-w-0 flex-1 text-sm"
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => setRenaming(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitRename()
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <Link
              to={href}
              className="focus-visible:ring-ring min-w-0 flex-1 truncate rounded px-1 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
              {...drag.listeners}
              {...drag.attributes}
              aria-roledescription={t`draggable document`}
              onKeyDown={(event) => {
                if (event.key === "F2") {
                  event.preventDefault()
                  startRename()
                } else if (event.key === "Enter" && event.shiftKey && onOpenSide !== undefined) {
                  event.preventDefault()
                  onOpenSide()
                }
              }}
            >
              {doc.icon !== null && <span aria-hidden="true">{doc.icon} </span>}
              {doc.title || t`Untitled`}
            </Link>
          )}
          <EntityActionsButton target={target} label={t`Actions for ${doc.title || t`Untitled`}`} />
        </div>
      </EntityContextMenu>
    </li>
  )
}
