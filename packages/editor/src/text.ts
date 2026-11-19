import { type JsonNode, childrenOf, stringAttr } from "./json.ts"

const INLINE: Record<string, true> = {
  text: true,
  mention: true,
  hardBreak: true,
  taskEmbed: true,
  fileAttachment: true,
}

const inlineText = (node: JsonNode): string => {
  if (node.type === "mention") {
    const label = stringAttr(node, "label", stringAttr(node, "id"))
    return label.length > 0 ? `@${label}` : ""
  }
  if (node.type === "taskEmbed") return "task"
  if (node.type === "fileAttachment") return stringAttr(node, "name")
  if (typeof node.text === "string") return node.text
  return childrenOf(node)
    .map((child) => inlineText(child))
    .join("")
}

const collect = (node: JsonNode, parts: string[]): void => {
  if (node.type === "image") {
    const alt = stringAttr(node, "alt")
    if (alt.length > 0) parts.push(alt)
    return
  }
  const children = childrenOf(node)
  if (children.every((child) => INLINE[child.type ?? ""] === true)) {
    const text = inlineText(node)
    if (text.length > 0) parts.push(text)
    return
  }
  for (const child of children) collect(child, parts)
}

/**
 * Plain text of a document for search, previews and notifications. Blocks are separated by spaces
 * and whitespace is collapsed.
 */
export const jsonToText = (json: JsonNode | null | undefined): string => {
  if (json === null || json === undefined) return ""
  const parts: string[] = []
  collect(json, parts)
  return parts.join(" ").replaceAll(/\s+/g, " ").trim()
}
