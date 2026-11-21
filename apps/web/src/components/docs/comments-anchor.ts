import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap"
import type { Editor } from "@tiptap/core"
import * as Y from "yjs"

/**
 * A comment's anchor: two Yjs relative positions (base64), so the range follows edits made by any
 * collaborator. Stored as `{ from, to }` in the comment's `anchor` JSON.
 */
export interface AnchorRange {
  readonly id: string
  readonly from: string
  readonly to: string
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

/** Encodes the document range `[from, to)` as a comment anchor, or `null` before the sync plugin runs. */
export const anchorFor = (editor: Editor, from: number, to: number) => {
  const sync = ySyncPluginKey.getState(editor.state)
  if (sync === undefined) return null
  const { type, mapping } = sync.binding
  return {
    from: toBase64(
      Y.encodeRelativePosition(absolutePositionToRelativePosition(from, type, mapping)),
    ),
    to: toBase64(Y.encodeRelativePosition(absolutePositionToRelativePosition(to, type, mapping))),
  }
}

const pluginKey = new PluginKey("commentAnchors")

/** Highlights the text each open comment is anchored to. */
export const CommentHighlight = Extension.create<{
  readonly getAnchors: () => ReadonlyArray<AnchorRange>
}>({
  name: "commentHighlight",

  addOptions() {
    return { getAnchors: () => [] }
  },

  addProseMirrorPlugins() {
    const { getAnchors } = this.options
    return [
      new Plugin({
        key: pluginKey,
        props: {
          decorations: (state) => {
            const sync = ySyncPluginKey.getState(state)
            const anchors = getAnchors()
            if (sync === undefined || anchors.length === 0) return DecorationSet.empty
            const { doc, type, mapping } = sync.binding
            const decorations: Decoration[] = []
            for (const anchor of anchors) {
              const from = relativePositionToAbsolutePosition(
                doc,
                type,
                Y.decodeRelativePosition(fromBase64(anchor.from)),
                mapping,
              )
              const to = relativePositionToAbsolutePosition(
                doc,
                type,
                Y.decodeRelativePosition(fromBase64(anchor.to)),
                mapping,
              )
              if (from === null || to === null || from >= to) continue
              decorations.push(
                Decoration.inline(from, to, {
                  class: "bg-amber-200/60 dark:bg-amber-500/25 rounded-sm",
                  "data-comment-id": anchor.id,
                }),
              )
            }
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
