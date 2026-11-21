import type { JSONContent } from "@tiptap/core"

export interface OutlineHeading {
  readonly level: 1 | 2 | 3
  readonly text: string
  /** ProseMirror position of the heading node, as used by `setTextSelection`. */
  readonly pos: number
}

/** Leaf nodes that occupy one position. Every other node without content is an empty block (size 2). */
const ATOMS: Readonly<Record<string, true>> = {
  image: true,
  horizontalRule: true,
  hardBreak: true,
  mention: true,
}

/** ProseMirror node size: text length, 2 + children for a block, 1 for an atom. */
const sizeOf = (node: JSONContent): number => {
  if (node.type === "text") return node.text?.length ?? 0
  if (node.content !== undefined)
    return 2 + node.content.reduce((sum, child) => sum + sizeOf(child), 0)
  return ATOMS[node.type ?? ""] === true ? 1 : 2
}

const textOf = (node: JSONContent): string => {
  if (node.type === "text") return node.text ?? ""
  return (node.content ?? []).map(textOf).join("")
}

const clampLevel = (raw: unknown): 1 | 2 | 3 => {
  const level = typeof raw === "number" ? Math.round(raw) : 1
  if (level <= 1) return 1
  if (level === 2) return 2
  return 3
}

/** Top-level headings of a doc, with their positions, for the outline pane. */
export const headingsFromDoc = (json: JSONContent): ReadonlyArray<OutlineHeading> => {
  const headings: OutlineHeading[] = []
  let pos = 0
  for (const node of json.content ?? []) {
    if (node.type === "heading") {
      headings.push({ level: clampLevel(node.attrs?.level), text: textOf(node).trim(), pos })
    }
    pos += sizeOf(node)
  }
  return headings
}
