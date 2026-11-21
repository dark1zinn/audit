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

/** An open picker: the text typed after the trigger, where it sits, and how to insert a choice. */
export interface MentionTrigger {
  readonly query: string
  readonly rect: DOMRect | null
  readonly insert: (item: MentionItem) => void
}

export interface MentionPickerOptions {
  readonly onTrigger: (trigger: MentionTrigger | null) => void
  /** Returns `true` when the picker consumed the key (arrows, Enter, Tab). */
  readonly onKeyDown: (event: KeyboardEvent) => boolean
}

export type MentionPickerExtension = Extension<MentionPickerOptions>

export interface PickerConfig {
  /** Extension name; also the ProseMirror plugin key, so it must be unique per editor. */
  readonly name: string
  /** The typed trigger: `@`, or `[[` for wikilinks. */
  readonly char: string
  /** Whether the query may contain spaces. */
  readonly allowSpaces: boolean
  /** Characters allowed right before the trigger. Default: start of text or a space. `null`: any. */
  readonly allowedPrefixes?: string[] | null
  /** Vetoes the match while `text` (trigger plus query) is typed, e.g. once `]]` closes a wikilink. */
  readonly allow?: (text: string) => boolean
}

/**
 * A ProseMirror suggestion that reports the open trigger to a React picker. The picker owns data
 * and keys; inserting a choice writes a `mention` node over the typed trigger and query.
 */
export const createPickerExtension = (config: PickerConfig): MentionPickerExtension =>
  Extension.create<MentionPickerOptions>({
    name: config.name,

    addOptions() {
      return { onTrigger: () => undefined, onKeyDown: () => false }
    },

    addProseMirrorPlugins() {
      const { onTrigger, onKeyDown } = this.options
      return [
        Suggestion<MentionItem, MentionItem>({
          editor: this.editor,
          pluginKey: new PluginKey(config.name),
          char: config.char,
          allowSpaces: config.allowSpaces,
          ...(config.allowedPrefixes === undefined
            ? {}
            : { allowedPrefixes: config.allowedPrefixes }),
          startOfLine: false,
          allow: ({ state, range }) =>
            config.allow?.(state.doc.textBetween(range.from, range.to, "\n")) ?? true,
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

/** Opens on `@` for people, teams, tasks, docs, threads and events. */
export const MentionPicker: MentionPickerExtension = createPickerExtension({
  name: "mentionPicker",
  char: "@",
  allowSpaces: false,
})

/**
 * Opens on `[[` for wiki links to docs and tasks. The query may contain spaces, may follow any
 * character, and closes as soon as `]]` is typed.
 */
export const WikilinkPicker: MentionPickerExtension = createPickerExtension({
  name: "wikilinkPicker",
  char: "[[",
  allowSpaces: true,
  allowedPrefixes: null,
  allow: (text) => !text.includes("]]"),
})
