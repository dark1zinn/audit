import { Collaboration } from "@tiptap/extension-collaboration"
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret"
import type { HocuspocusProvider } from "@hocuspocus/provider"
import type * as Y from "yjs"
import { extensions as sharedExtensions } from "@audit/editor/extensions"
import { taskEmbedNode, fileAttachmentNode } from "./nodes.tsx"
import { mentionNode } from "../mentions/mention-node.tsx"

/** Shared schema extensions with the web's React node views; Y.UndoManager replaces undo/redo. */
const OVERRIDDEN = new Set(["mention", "taskEmbed", "fileAttachment"])

export const baseExtensions = [
  ...sharedExtensions.filter((extension) => !OVERRIDDEN.has(extension.name)),
  mentionNode,
  taskEmbedNode,
  fileAttachmentNode,
]

export interface CollabUser {
  readonly name: string
  readonly color: string
}

/** Extensions for a live document bound to `ydoc`, with caret presence over `provider`. */
export const collabExtensions = (ydoc: Y.Doc, provider: HocuspocusProvider, user: CollabUser) => [
  ...baseExtensions,
  Collaboration.configure({ document: ydoc, field: "default" }),
  CollaborationCaret.configure({ provider, user }),
]
