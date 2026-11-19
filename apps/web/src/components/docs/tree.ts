import type { DocNode } from "@audit/domain/docs/schema"
import type { DocId } from "@audit/domain/ids"

/** A doc with its children, ordered by position. */
export interface TreeNode {
  readonly doc: DocNode
  readonly depth: number
  readonly children: ReadonlyArray<TreeNode>
}

/** Where a dragged doc lands relative to a target row. */
export type DropPlacement = "before" | "after" | "inside"

export interface MoveTarget {
  readonly parentId: DocNode["parentId"]
  /** Sibling to place after; `null` puts the doc first; `undefined` puts it last. */
  readonly afterId?: DocId | null
}

const byPosition = (a: DocNode, b: DocNode) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0

/** Nests a flat listing by `parentId`. Docs whose parent is not in the listing become roots. */
export const buildTree = (docs: ReadonlyArray<DocNode>): ReadonlyArray<TreeNode> => {
  const ids = new Set(docs.map((doc) => doc.id as string))
  const childrenOf = new Map<string, DocNode[]>()
  const roots: DocNode[] = []
  for (const doc of docs) {
    if (ids.has(doc.parentId)) {
      const siblings = childrenOf.get(doc.parentId) ?? []
      siblings.push(doc)
      childrenOf.set(doc.parentId, siblings)
    } else {
      roots.push(doc)
    }
  }
  const build = (nodes: ReadonlyArray<DocNode>, depth: number): ReadonlyArray<TreeNode> =>
    [...nodes].sort(byPosition).map((doc) => ({
      doc,
      depth,
      children: build(childrenOf.get(doc.id) ?? [], depth + 1),
    }))
  return build(roots, 0)
}

/** Depth-first rows of a tree, skipping children of collapsed nodes. */
export const visibleRows = (
  nodes: ReadonlyArray<TreeNode>,
  collapsed: ReadonlySet<string>,
): ReadonlyArray<TreeNode> =>
  nodes.flatMap((node) =>
    collapsed.has(node.doc.id) ? [node] : [node, ...visibleRows(node.children, collapsed)],
  )

/** Ids of `docId` and everything below it. */
export const subtreeIds = (docs: ReadonlyArray<DocNode>, docId: DocId): ReadonlySet<string> => {
  const result = new Set<string>([docId])
  let grew = true
  while (grew) {
    grew = false
    for (const doc of docs) {
      if (!result.has(doc.id) && result.has(doc.parentId)) {
        result.add(doc.id)
        grew = true
      }
    }
  }
  return result
}

/**
 * The move that puts `docId` at `placement` relative to `targetId`. Returns `undefined` when the
 * move is meaningless (dropping onto itself or into its own subtree).
 */
export const moveFor = (
  docs: ReadonlyArray<DocNode>,
  docId: DocId,
  targetId: DocId,
  placement: DropPlacement,
): MoveTarget | undefined => {
  if (docId === targetId) return undefined
  const target = docs.find((doc) => doc.id === targetId)
  if (target === undefined) return undefined
  if (placement === "inside") {
    if (subtreeIds(docs, docId).has(targetId)) return undefined
    return { parentId: target.id }
  }
  const siblings = docs
    .filter((doc) => doc.parentId === target.parentId && doc.id !== docId)
    .sort(byPosition)
  const index = siblings.findIndex((doc) => doc.id === targetId)
  if (placement === "after") return { parentId: target.parentId, afterId: target.id }
  const previous = siblings[index - 1]
  return { parentId: target.parentId, afterId: previous?.id ?? null }
}

/** Move one step up among siblings, as a `MoveTarget`, or `undefined` when already first. */
export const moveUp = (docs: ReadonlyArray<DocNode>, docId: DocId): MoveTarget | undefined => {
  const doc = docs.find((candidate) => candidate.id === docId)
  if (doc === undefined) return undefined
  const siblings = docs.filter((candidate) => candidate.parentId === doc.parentId).sort(byPosition)
  const index = siblings.findIndex((candidate) => candidate.id === docId)
  if (index <= 0) return undefined
  const beforePrevious = siblings[index - 2]
  return { parentId: doc.parentId, afterId: beforePrevious?.id ?? null }
}

/** Move one step down among siblings, or `undefined` when already last. */
export const moveDown = (docs: ReadonlyArray<DocNode>, docId: DocId): MoveTarget | undefined => {
  const doc = docs.find((candidate) => candidate.id === docId)
  if (doc === undefined) return undefined
  const siblings = docs.filter((candidate) => candidate.parentId === doc.parentId).sort(byPosition)
  const index = siblings.findIndex((candidate) => candidate.id === docId)
  const next = siblings[index + 1]
  if (index < 0 || next === undefined) return undefined
  return { parentId: doc.parentId, afterId: next.id }
}
