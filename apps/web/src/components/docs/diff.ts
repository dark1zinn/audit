/** Line diff for version comparison. Pure, so it can be tested without a DOM. */

export type DiffLine =
  | { readonly kind: "same"; readonly text: string }
  | { readonly kind: "removed"; readonly text: string }
  | { readonly kind: "added"; readonly text: string }

interface JsonNode {
  readonly type?: unknown
  readonly text?: unknown
  readonly content?: unknown
}

const textOf = (node: unknown): string => {
  if (typeof node !== "object" || node === null) return ""
  const json = node as JsonNode
  if (typeof json.text === "string") return json.text
  if (!Array.isArray(json.content)) return ""
  return json.content.map(textOf).join("")
}

/** One line per top-level block of a Tiptap document. */
export const contentLines = (content: unknown): ReadonlyArray<string> => {
  if (typeof content !== "object" || content === null) return []
  const blocks = (content as JsonNode).content
  if (!Array.isArray(blocks)) return []
  return blocks.map(textOf)
}

/** Longest-common-subsequence diff of two line lists. */
export const diffLines = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): ReadonlyArray<DiffLine> => {
  const rows = before.length + 1
  const cols = after.length + 1
  const table: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      result.push({ kind: "same", text: before[i]! })
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      result.push({ kind: "removed", text: before[i]! })
      i++
    } else {
      result.push({ kind: "added", text: after[j]! })
      j++
    }
  }
  for (; i < before.length; i++) result.push({ kind: "removed", text: before[i]! })
  for (; j < after.length; j++) result.push({ kind: "added", text: after[j]! })
  return result
}
