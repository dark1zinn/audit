import { Extension, InputRule, type Editor } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { callApi } from "../../lib/api.ts"
import type { MentionItem, MentionType } from "./mention-picker.ts"

/** A task key such as `ENG-142`, not part of a longer word, followed by space or punctuation. */
const TASK_KEY_RULE = /(?<![A-Za-z0-9-])([A-Z][A-Z0-9]{1,9}-\d+)[\s.,;:!?)]$/

type InternalLink =
  | { readonly _tag: "entity"; readonly type: MentionType; readonly id: string }
  | { readonly _tag: "task"; readonly key: string }

/** Reads an app URL on this origin: task, doc, or channel. Other pages are not mentionable. */
const internalLink = (text: string): InternalLink | null => {
  let url: URL
  try {
    url = new URL(text, window.location.origin)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  const parts = url.pathname.split("/").filter((part) => part !== "")
  const [first, project, marker, number] = parts
  if (first === "p" && marker === "t" && parts.length === 4 && number !== undefined) {
    if (project === undefined || !/^[A-Z][A-Z0-9]{1,9}$/.test(project)) return null
    return /^\d+$/.test(number) ? { _tag: "task", key: `${project}-${number}` } : null
  }
  const id = parts.at(-1)
  const kind = parts.at(-2)
  if (id === undefined || !/^[A-Za-z0-9_-]+$/.test(id)) return null
  if (kind === "docs") return { _tag: "entity", type: "doc", id }
  if (first === "c" && parts.length === 2) return { _tag: "entity", type: "channel", id }
  return null
}

/** Resolves a task key through quick find; only the exact `/p/<KEY>/t/<n>` hit counts. */
const resolveTask = async (key: string): Promise<MentionItem | null> => {
  const [project, number] = key.split("-")
  const hits = await callApi((api) => api.search.quick({ query: { q: key } }))
  const exact = hits.find((hit) => hit.type === "task" && hit.url === `/p/${project}/t/${number}`)
  return exact === undefined ? null : { id: exact.entityId, type: "task", label: exact.title }
}

/**
 * Swaps the typed text `from..to` for a mention, but only if the text is still the one resolved:
 * the user may have kept typing while the lookup ran.
 */
const replaceWithMention = (
  editor: Editor,
  from: number,
  to: number,
  expected: string,
  item: MentionItem,
) => {
  if (editor.state.doc.textBetween(from, to, "\n") !== expected) return
  editor
    .chain()
    .insertContentAt(
      { from, to },
      {
        type: "mention",
        attrs: { id: item.id, type: item.type, label: item.label },
      },
    )
    .run()
}

/**
 * Task keys become task mentions once followed by space or punctuation, and pasted app URLs become
 * mention chips. Both lookups are asynchronous, so the text stays until the answer arrives.
 */
export const MentionShortcuts = Extension.create({
  name: "mentionShortcuts",

  addInputRules() {
    const editor = this.editor
    return [
      new InputRule({
        find: TASK_KEY_RULE,
        handler: ({ range, match }) => {
          const key = match[1]
          if (key === undefined) return
          const from = range.from
          const to = from + key.length
          void resolveTask(key).then((item) => {
            if (item !== null) replaceWithMention(editor, from, to, key, item)
          })
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const text = event.clipboardData?.getData("text/plain").trim() ?? ""
            const link = internalLink(text)
            if (link === null) return false
            event.preventDefault()
            if (link._tag === "entity") {
              editor
                .chain()
                .focus()
                .insertContent([
                  { type: "mention", attrs: { id: link.id, type: link.type, label: "" } },
                  { type: "text", text: " " },
                ])
                .run()
              return true
            }
            editor.chain().focus().insertContent(link.key).run()
            const to = editor.state.selection.from
            const from = to - link.key.length
            void resolveTask(link.key).then((item) => {
              if (item !== null) replaceWithMention(editor, from, to, link.key, item)
            })
            return true
          },
        },
      }),
    ]
  },
})
