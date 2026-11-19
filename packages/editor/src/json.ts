/** The ProseMirror JSON shape the editor stores in `docs.content`, `tasks.description` and comments. */
export interface JsonNode {
  readonly type?: string
  readonly attrs?: Readonly<Record<string, unknown>>
  readonly content?: ReadonlyArray<JsonNode>
  readonly text?: string
  readonly marks?: ReadonlyArray<{
    readonly type: string
    readonly attrs?: Record<string, unknown>
  }>
}

export const isJsonNode = (value: unknown): value is JsonNode =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The children of a node, empty for leaves and malformed input. */
export const childrenOf = (node: JsonNode): ReadonlyArray<JsonNode> =>
  Array.isArray(node.content) ? node.content.filter(isJsonNode) : []

export const attr = (node: JsonNode, name: string): unknown => node.attrs?.[name]

/** A string attribute, or the fallback when it is missing or not a string. */
export const stringAttr = (node: JsonNode, name: string, fallback = ""): string => {
  const value = attr(node, name)
  return typeof value === "string" ? value : fallback
}
