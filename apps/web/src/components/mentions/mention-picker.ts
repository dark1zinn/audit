import { Extension } from "@tiptap/core"
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"

/** Mention types the `mention` node carries; the chip resolves the live title from the id. */
export type MentionType = "user" | "team" | "task" | "doc" | "message" | "channel" | "event"

export interface MentionItem {
  readonly id: string
  readonly type: MentionType
  readonly label: string
}

/** An open `@` picker: the text typed after `@`, where it sits, and how to insert a choice. */
export interface MentionTrigger {
  readonly query: string
  readonly rect: DOMRect | null
  readonly insert: (item: MentionItem) => void
}

interface MentionPickerOptions {
  readonly onTrigger: (trigger: MentionTrigger | null) => void
  /** Returns `true` when the picker consumed the key (arrows, Enter, Tab). */
  readonly onKeyDown: (event: KeyboardEvent) => boolean
}

/** Opens on `@` and reports the query to the React picker; the picker owns data and keys. */
export const MentionPicker = Extension.create<MentionPickerOptions>({
  name: "mentionPicker",

  addOptions() {
    return { onTrigger: () => undefined, onKeyDown: () => false }
  },

  addProseMirrorPlugins() {
    const { onTrigger, onKeyDown } = this.options
    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        pluginKey: new PluginKey("mentionPicker"),
        char: "@",
        allowSpaces: false,
        startOfLine: false,
        items: () => [],
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "mention", attrs: { id: props.id, type: props.type, label: props.label } },
              { type: "text", text: " " },
            ])
            .run()
        },
        render: () => {
          const publish = (props: SuggestionProps<MentionItem, MentionItem>) => {
            onTrigger({
              query: props.query,
              rect: props.clientRect?.() ?? null,
              insert: (item) => props.command(item),
            })
          }
          return {
            onStart: publish,
            onUpdate: publish,
            onKeyDown: ({ event }) => onKeyDown(event),
            onExit: () => onTrigger(null),
          }
        },
      }),
    ]
  },
})
