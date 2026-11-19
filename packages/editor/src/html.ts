/**
 * HTML export of a document as a plain string, with no DOM. The markup mirrors the editor's
 * `renderHTML` output so exported files look like the editor shows them.
 */
import { type JsonNode, attr, childrenOf, stringAttr } from "./json.ts"

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

const MARKS: Record<string, [string, string]> = {
  bold: ["<strong>", "</strong>"],
  italic: ["<em>", "</em>"],
  code: ["<code>", "</code>"],
}

const textHtml = (node: JsonNode): string => {
  let out = escape(node.text ?? "")
  for (const mark of node.marks ?? []) {
    const tags = MARKS[mark.type]
    if (tags !== undefined) out = `${tags[0]}${out}${tags[1]}`
  }
  return out
}

const inlineHtml = (node: JsonNode): string => {
  switch (node.type) {
    case "text":
      return textHtml(node)
    case "hardBreak":
      return "<br>"
    case "mention": {
      const label = stringAttr(node, "label", stringAttr(node, "id"))
      return `<span data-mention>@${escape(label)}</span>`
    }
    case "taskEmbed":
      return `<div data-task-embed>${escape(stringAttr(node, "taskId"))}</div>`
    case "fileAttachment":
      return `<div data-file-attachment>${escape(stringAttr(node, "name"))}</div>`
    default:
      return childrenOf(node).map(inlineHtml).join("")
  }
}

const wrap = (tag: string, inner: string, attrs = ""): string => `<${tag}${attrs}>${inner}</${tag}>`

const blockHtml = (node: JsonNode): string => {
  const inner = () => childrenOf(node).map(blockHtml).join("")
  switch (node.type) {
    case "doc":
      return inner()
    case "paragraph":
      return wrap("p", childrenOf(node).map(inlineHtml).join(""))
    case "heading":
      return wrap(`h${Number(attr(node, "level") ?? 1)}`, childrenOf(node).map(inlineHtml).join(""))
    case "blockquote":
      return wrap("blockquote", inner())
    case "callout":
      return wrap("aside", inner(), ` data-callout data-type="${escape(stringAttr(node, "type"))}"`)
    case "bulletList":
      return wrap("ul", inner())
    case "orderedList":
      return wrap("ol", inner(), ` start="${Number(attr(node, "start") ?? 1)}"`)
    case "listItem":
      return wrap("li", inner())
    case "taskList":
      return wrap("ul", inner(), ' data-type="taskList"')
    case "taskItem": {
      const checked = attr(node, "checked") === true ? " checked" : ""
      return wrap("li", inner(), ` data-type="taskItem"${checked}`)
    }
    case "codeBlock": {
      const language = stringAttr(node, "language")
      const body = childrenOf(node)
        .map((child) => escape(child.text ?? ""))
        .join("")
      const cls = language.length > 0 ? ` class="language-${escape(language)}"` : ""
      return wrap("pre", wrap("code", body, cls))
    }
    case "horizontalRule":
      return "<hr>"
    case "image":
      return `<img src="${escape(stringAttr(node, "src"))}" alt="${escape(stringAttr(node, "alt"))}">`
    case "table":
      return wrap("table", wrap("tbody", inner()))
    case "tableRow":
      return wrap("tr", inner())
    case "tableCell":
      return wrap("td", inner())
    case "tableHeader":
      return wrap("th", inner())
    default:
      return inlineHtml(node)
  }
}

/** HTML from Tiptap JSON. */
export const jsonToHtml = (json: JsonNode): string => blockHtml(json)
