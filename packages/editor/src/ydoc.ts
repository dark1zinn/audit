/**
 * Conversion between the Yjs document the editor syncs and the stored JSON. The field name is the
 * one the web `Collaboration` extension binds to.
 */
import { TiptapTransformer } from "@hocuspocus/transformer"
import * as Y from "yjs"
import { extensions } from "./extensions.ts"
import { type JsonNode, isJsonNode } from "./json.ts"

export const FIELD = "default"

const transformer = TiptapTransformer.extensions(extensions)

/** The JSON of an empty document: one empty paragraph. */
export const EMPTY_DOC: JsonNode = { type: "doc", content: [{ type: "paragraph" }] }

/** Y.Doc from Tiptap JSON. */
export const jsonToYdoc = (json: JsonNode): Y.Doc => transformer.toYdoc(json, FIELD)

/** The full Yjs state (updates applied to an empty doc) for storage. */
export const ydocToState = (ydoc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(ydoc)

/** Tiptap JSON from a Y.Doc. */
export const ydocToJson = (ydoc: Y.Doc): JsonNode => {
  const json: unknown = transformer.fromYdoc(ydoc, FIELD)
  return isJsonNode(json) ? json : EMPTY_DOC
}

/** Tiptap JSON from stored Yjs state. Empty or missing state gives the empty document. */
export const stateToJson = (state: Uint8Array | null): JsonNode => {
  if (state === null || state.byteLength === 0) return EMPTY_DOC
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state)
  return ydocToJson(ydoc)
}

/** Yjs state from Tiptap JSON. Used by the server when it writes content without a live session. */
export const jsonToState = (json: JsonNode): Uint8Array => ydocToState(jsonToYdoc(json))
