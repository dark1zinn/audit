/**
 * Server-side gate for rich text. Every stored document (command inputs, collab state, AI edits)
 * passes through `sanitizeRichDoc`: it checks the structure against the editor schema, keeps only
 * allowlisted attributes and marks, and enforces size, depth and reference rules. Anything it
 * cannot normalise is rejected with `RichDocError`; nothing is stored half-cleaned.
 */
import { schema } from "./schema.ts"
import { type JsonNode, isJsonNode } from "./json.ts"

export const RICH_DOC_LIMITS = {
  /** Serialised JSON size in characters. */
  chars: 256 * 1024,
  /** Nesting depth of the node tree, the root counting as 1. */
  depth: 32,
  /** Total number of nodes, marks excluded. */
  nodes: 5_000,
  /** Maximum length of a text node, a label or any other free-text attribute. */
  text: 2_000,
} as const

/** Mention targets the web editor can insert. Anything else is refused. */
export const MENTION_TYPES = [
  "user",
  "team",
  "task",
  "doc",
  "message",
  "channel",
  "event",
  "project",
] as const

/** `@channel` / `@here`: the id and type are both the broadcast name, not an entity id. */
const BROADCAST_MENTIONS: ReadonlyArray<unknown> = ["channel", "here"]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** An image may only point at a stored file served by the files route. */
const FILE_SRC = /^\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Links may only navigate to web or mail destinations. */
const SAFE_HREF = /^(https?:\/\/|mailto:)/i
const isControl = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

export class RichDocError extends Error {
  readonly _tag = "RichDocError"
  constructor(readonly reason: string) {
    super(reason)
  }
}

function fail(reason: string): never {
  throw new RichDocError(reason)
}

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value)

const boundedText = (value: unknown, field: string, max: number = RICH_DOC_LIMITS.text): string => {
  if (typeof value !== "string") return fail(`${field} must be text`)
  if (value.length > max) return fail(`${field} is too long`)
  return [...value].filter((char) => !isControl(char)).join("")
}

const optionalText = (value: unknown, field: string, max?: number): string | null =>
  value === null || value === undefined ? null : boundedText(value, field, max)

/** The allowlisted attributes of one node type, validated; unknown keys are dropped. */
const sanitizeAttrs = (type: string, attrs: Record<string, unknown>): Record<string, unknown> => {
  switch (type) {
    case "image": {
      const src = attrs.src
      if (typeof src !== "string" || !FILE_SRC.test(src)) fail("image source is not a stored file")
      const out: Record<string, unknown> = { src }
      if (attrs.alt !== undefined) out.alt = optionalText(attrs.alt, "alt")
      if (attrs.title !== undefined) out.title = optionalText(attrs.title, "title")
      return out
    }
    case "mention": {
      const broadcast = BROADCAST_MENTIONS.includes(attrs.id) && attrs.type === attrs.id
      if (!broadcast && !isUuid(attrs.id)) fail("mention id is not an id")
      if (!broadcast && !(MENTION_TYPES as ReadonlyArray<unknown>).includes(attrs.type)) {
        fail("mention type is not allowed")
      }
      return {
        id: attrs.id,
        type: attrs.type,
        label: optionalText(attrs.label, "mention label", 200),
      }
    }
    case "taskEmbed":
      if (!isUuid(attrs.taskId)) fail("task embed id is not an id")
      return { taskId: attrs.taskId }
    case "fileAttachment": {
      if (!isUuid(attrs.fileId)) fail("attachment id is not an id")
      const size = attrs.size ?? 0
      if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
        fail("attachment size is invalid")
      }
      return {
        fileId: attrs.fileId,
        name: boundedText(attrs.name ?? "", "attachment name", 255),
        size,
      }
    }
    default: {
      const schemaAttrs = schema.nodes[type]?.spec.attrs ?? {}
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(schemaAttrs)) {
        const value = attrs[key]
        if (value === undefined) continue
        if (value === null || typeof value === "boolean") out[key] = value
        else if (typeof value === "number" && Number.isFinite(value)) out[key] = value
        else if (typeof value === "string") out[key] = boundedText(value, key)
        else fail(`attribute ${key} has an unsupported value`)
      }
      return out
    }
  }
}

type JsonMark = NonNullable<JsonNode["marks"]>[number]

const sanitizeMark = (mark: unknown): JsonMark => {
  if (!isJsonNode(mark) || typeof mark.type !== "string") fail("mark is malformed")
  const type = mark.type
  if (schema.marks[type] === undefined) fail(`mark ${type} is not allowed`)
  if (type !== "link") return { type }
  const attrs = mark.attrs ?? {}
  if (typeof attrs.href !== "string" || !SAFE_HREF.test(attrs.href)) {
    fail("link destination is not allowed")
  }
  if (attrs.href.length > 2048) fail("link destination is too long")
  return { type, attrs: { href: attrs.href } }
}

const sanitizeNode = (node: unknown, depth: number, budget: { nodes: number }): JsonNode => {
  if (depth > RICH_DOC_LIMITS.depth) fail("document is nested too deeply")
  if (!isJsonNode(node) || typeof node.type !== "string") fail("node is malformed")
  budget.nodes -= 1
  if (budget.nodes < 0) fail("document has too many nodes")

  const type = node.type
  if (type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) fail("text node is empty")
    if (node.text.length > RICH_DOC_LIMITS.chars) fail("text node is too long")
    const marks = Array.isArray(node.marks) ? node.marks.map(sanitizeMark) : []
    return marks.length > 0 ? { type, text: node.text, marks } : { type, text: node.text }
  }
  if (schema.nodes[type] === undefined) fail(`node ${type} is not allowed`)
  if (node.text !== undefined) fail(`node ${type} cannot carry text`)

  const attrs = node.attrs ?? {}
  if (!isJsonNode(attrs)) fail(`node ${type} has malformed attributes`)
  const cleaned = sanitizeAttrs(type, attrs)
  const children = node.content === undefined ? [] : node.content
  if (!Array.isArray(children)) fail(`node ${type} has malformed content`)
  const content = children.map((child) => sanitizeNode(child, depth + 1, budget))
  return {
    type,
    ...(Object.keys(cleaned).length > 0 ? { attrs: cleaned } : {}),
    ...(content.length > 0 ? { content } : {}),
  }
}

/**
 * Returns the document rebuilt from its allowlisted parts. Throws `RichDocError` when the input is
 * not a document the editor schema accepts. The result is safe to store and render.
 */
export const sanitizeRichDoc = (input: unknown): JsonNode => {
  if (!isJsonNode(input)) fail("document must be an object")
  const serialised = JSON.stringify(input) ?? ""
  if (serialised.length > RICH_DOC_LIMITS.chars) fail("document is too large")
  if (input.type !== "doc") fail("document root must be a doc")

  const budget = { nodes: RICH_DOC_LIMITS.nodes }
  const content = Array.isArray(input.content) ? input.content : []
  const root: JsonNode = {
    type: "doc",
    content: content.map((child) => sanitizeNode(child, 2, budget)),
  }
  if (root.content!.length === 0) return { type: "doc", content: [{ type: "paragraph" }] }

  // The schema's content rules (what may nest in what, required children) have the final say.
  try {
    schema.nodeFromJSON(root).check()
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : "document does not match the editor schema")
  }
  return root
}

/** Whether a value is a document `sanitizeRichDoc` accepts; the normalised copy is discarded. */
export const isValidRichDoc = (input: unknown): boolean => {
  try {
    sanitizeRichDoc(input)
    return true
  } catch (cause) {
    if (cause instanceof RichDocError) return false
    throw cause
  }
}
