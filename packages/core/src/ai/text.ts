import type { RichDoc } from "@audit/domain/tasks/schema"

/** A plain-text rich document: one paragraph per line, as the editor stores it. */
export const richDocFromText = (text: string): RichDoc => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: line.length === 0 ? [] : [{ type: "text", text: line }],
  })),
})
