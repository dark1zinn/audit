/**
 * Server-side gate for rich text. Every stored document (command inputs, collab state, AI edits)
 * passes through `sanitizeRichDoc`: it checks the structure against the editor schema, keeps only
 * allowlisted attributes and marks, and enforces size, depth and reference rules. Structural
 * violations are rejected with `RichDocError`; content that is merely unsafe to render (an external
 * image, a link to a script URL) loses that element and keeps its text. Nothing is stored
 * half-cleaned.
 */
import { STORED_FILE_SRC } from "./extensions.ts"
import { schema } from "./schema.ts"
import { type JsonNode, isJsonNode } from "./json.ts"

/** Chat and comments are `message`s; documents, task and event descriptions are `doc`s. */
export type RichDocKind = "message" | "doc"

export const RICH_DOC_LIMITS = {
  message: {
    /** Serialised JSON size in characters. */
    chars: 256 * 1024,
    /** Total number of nodes, marks excluded. */
    nodes: 5_000,
  },
  doc: {
    chars: 1024 * 1024,
    nodes: 20_000,
  },
  /** Nesting depth of the node tree, the root counting as 1. */
  depth: 32,
  /** Maximum length of a free-text attribute. */
  text: 2_000,
  /** Maximum length of a mention label. */
  mentionLabel: 300,
  /** Longer link destinations lose their link mark. */
  href: 2_048,
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
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** Schemes a link may navigate to. Everything else, including `javascript:`, is dropped. */
const LINK_SCHEME = /^(https?|mailto|tel):/i
/** Protocol-relative and backslash forms ("//host", "/\host") name another host in browsers. */
const HOST_RELATIVE = /^[/\\]{2}/
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

/** Table column widths: one finite number or `null` per column. */
const isColumnWidths = (value: unknown): value is ReadonlyArray<number | null> =>
  Array.isArray(value) &&
  value.every((width) => width === null || (typeof width === "number" && Number.isFinite(width)))

/** The allowlisted attributes of one node type, validated; unknown keys are dropped. */
const sanitizeAttrs = (type: string, attrs: Record<string, unknown>): Record<string, unknown> => {
  switch (type) {
    case "image": {
      const src = attrs.src
      if (typeof src !== "string" || !STORED_FILE_SRC.test(src))
        fail("image source is not a stored file")
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
        label: optionalText(attrs.label, "mention label", RICH_DOC_LIMITS.mentionLabel),
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
        else if (key === "colwidth" && isColumnWidths(value)) out[key] = value
        // Any other shape is not something the editor writes; the attribute is dropped.
      }
      return out
    }
  }
}

type JsonMark = NonNullable<JsonNode["marks"]>[number]

/**
 * The mark, or `null` when its destination is unsafe to navigate to. The caller keeps the text.
 * Browsers ignore control characters and spaces inside a URL, so the check strips them first.
 */
const sanitizeMark = (mark: unknown): JsonMark | null => {
  if (!isJsonNode(mark) || typeof mark.type !== "string") fail("mark is malformed")
  const type = mark.type
  if (schema.marks[type] === undefined) fail(`mark ${type} is not allowed`)
  if (type !== "link") return { type }
  const attrs = mark.attrs ?? {}
  if (typeof attrs.href !== "string") fail("link destination must be text")
  const href = attrs.href
  const effective = [...href].filter((char) => char.charCodeAt(0) > 0x20).join("")
  const safe = SCHEME.test(effective) ? LINK_SCHEME.test(effective) : !HOST_RELATIVE.test(effective)
  if (!safe || href.length > RICH_DOC_LIMITS.href) return null
  return { type, attrs: { href } }
}

/** Whether an image node points at a stored file. Others are dropped, not refused. */
const isStoredImage = (attrs: Readonly<Record<string, unknown>> | undefined): boolean => {
  const src = attrs?.src
  return typeof src === "string" && STORED_FILE_SRC.test(src)
}

interface Budget {
  nodes: number
}

/** Sanitises a sibling list; dropped nodes (unstored images) are simply absent from the result. */
const keepNodes = (nodes: ReadonlyArray<unknown>, depth: number, budget: Budget): JsonNode[] =>
  nodes.flatMap((child) => {
    const kept = sanitizeNode(child, depth, budget)
    return kept === null ? [] : [kept]
  })

const sanitizeNode = (node: unknown, depth: number, budget: Budget): JsonNode | null => {
  if (depth > RICH_DOC_LIMITS.depth) fail("document is nested too deeply")
  if (!isJsonNode(node) || typeof node.type !== "string") fail("node is malformed")
  budget.nodes -= 1
  if (budget.nodes < 0) fail("document has too many nodes")

  const type = node.type
  if (type === "text") {
    if (typeof node.text !== "string" || node.text.length === 0) fail("text node is empty")
    const marks = Array.isArray(node.marks)
      ? node.marks.flatMap((mark) => {
          const kept = sanitizeMark(mark)
          return kept === null ? [] : [kept]
        })
      : []
    return marks.length > 0 ? { type, text: node.text, marks } : { type, text: node.text }
  }
  if (schema.nodes[type] === undefined) fail(`node ${type} is not allowed`)
  if (node.text !== undefined) fail(`node ${type} cannot carry text`)
  if (type === "image" && !isStoredImage(node.attrs)) return null

  const attrs = node.attrs ?? {}
  if (!isJsonNode(attrs)) fail(`node ${type} has malformed attributes`)
  const cleaned = sanitizeAttrs(type, attrs)
  const children = node.content === undefined ? [] : node.content
  if (!Array.isArray(children)) fail(`node ${type} has malformed content`)
  const content = keepNodes(children, depth + 1, budget)
  // Dropped children can leave a required container empty; a paragraph keeps it valid.
  if (content.length === 0 && schema.nodes[type]?.contentMatch.validEnd === false) {
    content.push({ type: "paragraph" })
  }
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
export const sanitizeRichDoc = (input: unknown, kind: RichDocKind): JsonNode => {
  const limits = RICH_DOC_LIMITS[kind]
  if (!isJsonNode(input)) fail("document must be an object")
  const serialised = JSON.stringify(input) ?? ""
  if (serialised.length > limits.chars) fail("document is too large")
  if (input.type !== "doc") fail("document root must be a doc")

  const children = keepNodes(Array.isArray(input.content) ? input.content : [], 2, {
    nodes: limits.nodes,
  })
  if (children.length === 0) return { type: "doc", content: [{ type: "paragraph" }] }

  const root: JsonNode = { type: "doc", content: children }
  // The schema's content rules (what may nest in what, required children) have the final say.
  try {
    schema.nodeFromJSON(root).check()
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : "document does not match the editor schema")
  }
  return root
}

/** Whether a value is a document `sanitizeRichDoc` accepts; the normalised copy is discarded. */
export const isValidRichDoc = (input: unknown, kind: RichDocKind): boolean => {
  try {
    sanitizeRichDoc(input, kind)
    return true
  } catch (cause) {
    if (cause instanceof RichDocError) return false
    throw cause
  }
}
