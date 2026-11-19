/**
 * Markdown import and export for the editor's document model. Covers headings, paragraphs,
 * bullet, ordered and task lists (flat items), code blocks, quotes, callouts, dividers, images,
 * tables, and bold, italic and code marks. Other syntax is kept as plain text.
 */
import { type JsonNode, attr, childrenOf, stringAttr } from "./json.ts"

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^```\s*([\w+-]*)\s*$/
const RULE = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const CALLOUT = /^\[!(info|warning|success|danger)\]\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(_[^_\s][^_\n]*_)|\[([^\]\n]+)\]\([^)\n]*\)/g

const text = (value: string, marks?: JsonNode["marks"]): JsonNode =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks }

/** Inline Markdown into text nodes with bold, italic and code marks. */
export const parseInline = (source: string): JsonNode[] => {
  const nodes: JsonNode[] = []
  let last = 0
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text(source.slice(last, index)))
    last = index + match[0].length
    const [whole, code, bold, italic, under, link] = match
    if (code !== undefined) nodes.push(text(code.slice(1, -1), [{ type: "code" }]))
    else if (bold !== undefined) nodes.push(text(bold.slice(2, -2), [{ type: "bold" }]))
    else if (italic !== undefined) nodes.push(text(italic.slice(1, -1), [{ type: "italic" }]))
    else if (under !== undefined) nodes.push(text(under.slice(1, -1), [{ type: "italic" }]))
    else if (link !== undefined) nodes.push(text(link))
    else nodes.push(text(whole))
  }
  if (last < source.length) nodes.push(text(source.slice(last)))
  return nodes
}

const paragraph = (source: string): JsonNode => {
  const content = parseInline(source)
  return content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content }
}

const listItem = (source: string): JsonNode => ({
  type: "listItem",
  content: [paragraph(source)],
})

interface Cursor {
  readonly lines: string[]
  index: number
}

const isBlank = (line: string) => line.trim().length === 0

/** Parses one block starting at the cursor, advancing it past the block. */
const parseBlock = (cursor: Cursor): JsonNode | null => {
  const line = cursor.lines[cursor.index] ?? ""
  if (isBlank(line)) {
    cursor.index += 1
    return null
  }
  const fence = FENCE.exec(line)
  if (fence !== null) return parseCode(cursor, fence[1] ?? "")
  const heading = HEADING.exec(line)
  if (heading !== null) {
    cursor.index += 1
    const level = heading[1]!.length
    return { type: "heading", attrs: { level }, content: parseInline(heading[2]!) }
  }
  if (RULE.test(line)) {
    cursor.index += 1
    return { type: "horizontalRule" }
  }
  const image = IMAGE.exec(line.trim())
  if (image !== null) {
    cursor.index += 1
    return { type: "image", attrs: { src: image[2], alt: image[1] } }
  }
  if (QUOTE.test(line)) return parseQuote(cursor)
  if (TABLE_ROW.test(line) && TABLE_RULE.test(cursor.lines[cursor.index + 1] ?? "")) {
    return parseTable(cursor)
  }
  if (TASK.test(line)) return parseList(cursor, "task")
  if (BULLET.test(line)) return parseList(cursor, "bullet")
  if (ORDERED.test(line)) return parseList(cursor, "ordered")
  return parseParagraph(cursor)
}

const parseCode = (cursor: Cursor, language: string): JsonNode => {
  const body: string[] = []
  cursor.index += 1
  while (cursor.index < cursor.lines.length && !/^```\s*$/.test(cursor.lines[cursor.index]!)) {
    body.push(cursor.lines[cursor.index]!)
    cursor.index += 1
  }
  cursor.index += 1
  const code = body.join("\n")
  return {
    type: "codeBlock",
    attrs: { language: language.length > 0 ? language : null },
    content: code.length > 0 ? [text(code)] : [],
  }
}

const parseQuote = (cursor: Cursor): JsonNode => {
  const inner: string[] = []
  while (cursor.index < cursor.lines.length && QUOTE.test(cursor.lines[cursor.index]!)) {
    inner.push(QUOTE.exec(cursor.lines[cursor.index]!)![1]!)
    cursor.index += 1
  }
  const callout = CALLOUT.exec(inner[0] ?? "")
  if (callout !== null) {
    const body = parseBlocks(inner.slice(1))
    return { type: "callout", attrs: { type: callout[1] }, content: body }
  }
  return { type: "blockquote", content: parseBlocks(inner) }
}

const parseList = (cursor: Cursor, kind: "task" | "bullet" | "ordered"): JsonNode => {
  const items: JsonNode[] = []
  const pattern = kind === "task" ? TASK : kind === "bullet" ? BULLET : ORDERED
  let start: number | null = null
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index]!
    const match = pattern.exec(line)
    if (match === null) break
    if (kind === "ordered" && start === null) start = Number(match[1])
    cursor.index += 1
    if (kind === "task") {
      items.push({
        type: "taskItem",
        attrs: { checked: match[1] !== " " },
        content: [paragraph(match[2]!)],
      })
    } else {
      items.push(listItem(kind === "ordered" ? match[2]! : match[1]!))
    }
  }
  if (kind === "task") return { type: "taskList", content: items }
  if (kind === "bullet") return { type: "bulletList", content: items }
  return { type: "orderedList", attrs: { start: start ?? 1 }, content: items }
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "|"))

const tableRow = (cells: string[], header: boolean): JsonNode => ({
  type: "tableRow",
  content: cells.map((cell) => ({
    type: header ? "tableHeader" : "tableCell",
    content: [paragraph(cell)],
  })),
})

const parseTable = (cursor: Cursor): JsonNode => {
  const rows: JsonNode[] = [tableRow(splitRow(cursor.lines[cursor.index]!), true)]
  cursor.index += 2
  while (cursor.index < cursor.lines.length && TABLE_ROW.test(cursor.lines[cursor.index]!)) {
    rows.push(tableRow(splitRow(cursor.lines[cursor.index]!), false))
    cursor.index += 1
  }
  return { type: "table", content: rows }
}

const parseParagraph = (cursor: Cursor): JsonNode => {
  const parts: string[] = []
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index]!
    if (isBlank(line) || startsBlock(line)) break
    parts.push(line.trim())
    cursor.index += 1
  }
  return paragraph(parts.join(" "))
}

const startsBlock = (line: string): boolean =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  RULE.test(line) ||
  QUOTE.test(line) ||
  BULLET.test(line) ||
  ORDERED.test(line)

const parseBlocks = (lines: string[]): JsonNode[] => {
  const cursor: Cursor = { lines, index: 0 }
  const blocks: JsonNode[] = []
  while (cursor.index < lines.length) {
    const block = parseBlock(cursor)
    if (block !== null) blocks.push(block)
  }
  return blocks
}

/** Tiptap JSON from Markdown. An empty input gives a document with one empty paragraph. */
export const markdownToJson = (markdown: string): JsonNode => {
  const blocks = parseBlocks(markdown.replaceAll("\r\n", "\n").split("\n"))
  return { type: "doc", content: blocks.length > 0 ? blocks : [{ type: "paragraph" }] }
}

const mark = (value: string, marks: ReadonlyArray<{ readonly type: string }>): string => {
  let out = value
  for (const { type } of marks) {
    if (type === "code") out = `\`${out}\``
    else if (type === "bold") out = `**${out}**`
    else if (type === "italic") out = `*${out}*`
  }
  return out
}

const inlineOf = (node: JsonNode): string =>
  childrenOf(node)
    .map((child) => {
      if (child.type === "hardBreak") return "  \n"
      if (child.type === "mention") return `@${stringAttr(child, "label", stringAttr(child, "id"))}`
      if (child.type === "taskEmbed") return `[task:${stringAttr(child, "taskId")}]`
      if (child.type === "fileAttachment") {
        return `[${stringAttr(child, "name")}](/files/${stringAttr(child, "fileId")})`
      }
      return mark(child.text ?? "", child.marks ?? [])
    })
    .join("")

const indent = (lines: string[], prefix: string): string[] =>
  lines.map((line) => (line.length > 0 ? `${prefix}${line}` : line))

/** The lines of a block node. */
const blockLines = (node: JsonNode): string[] => {
  switch (node.type) {
    case "paragraph":
      return [inlineOf(node)]
    case "heading":
      return [`${"#".repeat(Number(attr(node, "level") ?? 1))} ${inlineOf(node)}`]
    case "horizontalRule":
      return ["---"]
    case "image":
      return [`![${stringAttr(node, "alt")}](${stringAttr(node, "src")})`]
    case "taskEmbed":
      return [`[task:${stringAttr(node, "taskId")}]`]
    case "fileAttachment":
      return [`[${stringAttr(node, "name")}](/files/${stringAttr(node, "fileId")})`]
    case "codeBlock":
      return [
        `\`\`\`${stringAttr(node, "language")}`,
        ...childrenOf(node).map((child) => child.text ?? ""),
        "```",
      ]
    case "blockquote":
      return indent(joinBlocks(childrenOf(node)), "> ")
    case "callout":
      return [
        `> [!${stringAttr(node, "type", "info")}]`,
        ...indent(joinBlocks(childrenOf(node)), "> "),
      ]
    case "bulletList":
      return listLines(node, () => "- ")
    case "taskList":
      return listLines(node, (item) => (attr(item, "checked") === true ? "- [x] " : "- [ ] "))
    case "orderedList": {
      const start = Number(attr(node, "start") ?? 1)
      return listLines(node, (_item, index) => `${start + index}. `)
    }
    case "table":
      return tableLines(node)
    default:
      return childrenOf(node).length > 0 ? joinBlocks(childrenOf(node)) : []
  }
}

const listLines = (node: JsonNode, marker: (item: JsonNode, index: number) => string): string[] =>
  childrenOf(node).flatMap((item, index) => {
    const prefix = marker(item, index)
    const body = joinBlocks(childrenOf(item))
    if (body.length === 0) return [prefix.trimEnd()]
    const pad = " ".repeat(prefix.length)
    return [`${prefix}${body[0]}`, ...indent(body.slice(1), pad)]
  })

const tableLines = (node: JsonNode): string[] => {
  const rows = childrenOf(node).map((row) =>
    childrenOf(row).map((cell) => joinBlocks(childrenOf(cell)).join(" ").replaceAll("|", "\\|")),
  )
  const first = rows[0] ?? []
  if (first.length === 0) return []
  const rule = `| ${first.map(() => "---").join(" | ")} |`
  return [
    `| ${first.join(" | ")} |`,
    rule,
    ...rows.slice(1).map((cells) => `| ${cells.join(" | ")} |`),
  ]
}

/** Lines of a sequence of blocks, with a blank line between them. */
const joinBlocks = (nodes: ReadonlyArray<JsonNode>): string[] => {
  const out: string[] = []
  nodes.forEach((node, index) => {
    if (index > 0) out.push("")
    out.push(...blockLines(node))
  })
  return out
}

/** Markdown from Tiptap JSON. */
export const jsonToMarkdown = (json: JsonNode): string => {
  const lines = joinBlocks(childrenOf(json))
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`
}
