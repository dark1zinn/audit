/**
 * Validates and normalises rich text from any writer before it is stored: user input, AI edits and
 * collab state alike. A refusal is a `ValidationError` naming the field.
 */
import { ValidationError } from "@audit/domain/errors"
import { isJsonNode } from "@audit/editor/json"
import { type RichDocKind, RichDocError, sanitizeRichDoc } from "@audit/editor/sanitize"
import { Effect } from "effect"

export const cleanRichDoc = (input: unknown, field: string, kind: RichDocKind) =>
  Effect.try({
    try: () => sanitizeRichDoc(input, kind),
    catch: (cause) =>
      new ValidationError({
        message: cause instanceof RichDocError ? cause.reason : "document is invalid",
        field,
      }),
  })

/** Images and link marks: the only things cleaning drops (everything else is kept or refused). */
const droppableCount = (node: unknown): number => {
  if (!isJsonNode(node)) return 0
  const self = node.type === "image" ? 1 : 0
  const links = Array.isArray(node.marks)
    ? node.marks.filter((mark) => isJsonNode(mark) && mark.type === "link").length
    : 0
  const children = Array.isArray(node.content)
    ? node.content.reduce((sum: number, child) => sum + droppableCount(child), 0)
    : 0
  return self + links + children
}

/** Whether cleaning dropped content, so the stored Yjs state must be rebuilt from the clean JSON. */
export const droppedContent = (raw: unknown, cleaned: unknown): boolean =>
  droppableCount(raw) !== droppableCount(cleaned)

/** Largest serialised comment anchor; an anchor is a selection, not a copy of the document. */
const ANCHOR_MAX_CHARS = 4_096

export const boundAnchor = <T>(anchor: T, field: string) =>
  Effect.gen(function* () {
    if (JSON.stringify(anchor).length > ANCHOR_MAX_CHARS) {
      return yield* Effect.fail(new ValidationError({ message: "anchor is too large", field }))
    }
    return anchor
  })
