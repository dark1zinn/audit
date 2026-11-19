import { jsonToText } from "./text.ts"
import { type JsonNode, childrenOf, isJsonNode, stringAttr } from "./json.ts"

export const SNIPPET_MAX = 140

export interface Mention {
  readonly id: string
  readonly type: string
  /** The text of the block the mention sits in, at most `SNIPPET_MAX` characters. */
  readonly snippet: string
}

const snippetOf = (block: JsonNode): string => {
  const text = jsonToText(block)
  return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX) : text
}

const walk = (node: JsonNode, block: JsonNode, found: Map<string, Mention>): void => {
  if (node.type === "mention") {
    const id = stringAttr(node, "id")
    const type = stringAttr(node, "type", "user")
    const key = `${type}:${id}`
    if (id.length > 0 && !found.has(key)) found.set(key, { id, type, snippet: snippetOf(block) })
    return
  }
  // The nearest ancestor holding inline content supplies the snippet.
  const inline = childrenOf(node).some((child) => child.type === "text" || child.type === "mention")
  const nextBlock = inline ? node : block
  for (const child of childrenOf(node)) walk(child, nextBlock, found)
}

/** Every distinct mention in a document, in document order. Deduplicated by type and id. */
export const extractMentions = (json: unknown): Mention[] => {
  if (!isJsonNode(json)) return []
  const found = new Map<string, Mention>()
  walk(json, json, found)
  return [...found.values()]
}
