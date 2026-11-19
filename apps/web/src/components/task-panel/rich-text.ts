import type { RichDoc } from "@audit/domain/tasks/schema"

/** Plain text of a Tiptap document, used for previews and conflict summaries. */
export const richText = (doc: RichDoc | null): string => {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return
    const record = node as {
      readonly type?: unknown
      readonly text?: unknown
      readonly content?: unknown
    }
    if (typeof record.text === "string") parts.push(record.text)
    if (Array.isArray(record.content)) record.content.forEach(walk)
  }
  walk(doc)
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

export const emptyDoc: RichDoc = { type: "doc", content: [{ type: "paragraph" }] }
