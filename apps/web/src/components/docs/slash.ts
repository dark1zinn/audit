import { Extension, type Editor, type Range } from "@tiptap/core"
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion"
import { PluginKey } from "@tiptap/pm/state"

/** One entry of the `/` menu. `run` replaces the typed `/query` range with its content. */
export interface SlashItem {
  readonly key: string
  readonly title: string
  readonly keywords: ReadonlyArray<string>
  readonly run: (editor: Editor, range: Range) => void
}

/** What the React menu renders. `select` runs an item; `null` means the menu is closed. */
export interface SlashState {
  readonly items: ReadonlyArray<SlashItem>
  readonly index: number
  readonly rect: DOMRect | null
  readonly select: (item: SlashItem) => void
}

interface SlashStorage {
  items: ReadonlyArray<SlashItem>
}

declare module "@tiptap/core" {
  interface Storage {
    slashCommand: SlashStorage
  }
}

interface SlashOptions {
  readonly onState: (state: SlashState | null) => void
}

const matches = (item: SlashItem, query: string) => {
  const needle = query.toLowerCase()
  return (
    item.title.toLowerCase().includes(needle) ||
    item.keywords.some((keyword) => keyword.includes(needle))
  )
}

/** Opens the slash menu on `/` at the start of a line or after a space. */
export const SlashCommand = Extension.create<SlashOptions, SlashStorage>({
  name: "slashCommand",

  addOptions() {
    return { onState: () => undefined }
  },

  addStorage() {
    return { items: [] }
  },

  addProseMirrorPlugins() {
    const { onState } = this.options
    const storage = this.storage
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: new PluginKey("slashCommand"),
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => storage.items.filter((item) => matches(item, query)).slice(0, 12),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let latest: SuggestionProps<SlashItem, SlashItem> | null = null
          let index = 0
          const publish = (props: SuggestionProps<SlashItem, SlashItem>) => {
            latest = props
            onState({
              items: props.items,
              index,
              rect: props.clientRect?.() ?? null,
              select: (item) => props.command(item),
            })
          }
          return {
            onStart: (props) => {
              index = 0
              publish(props)
            },
            onUpdate: (props) => {
              index = Math.min(index, Math.max(props.items.length - 1, 0))
              publish(props)
            },
            onKeyDown: ({ event }) => {
              if (latest === null) return false
              const count = latest.items.length
              if (event.key === "ArrowDown" && count > 0) {
                index = (index + 1) % count
                publish(latest)
                return true
              }
              if (event.key === "ArrowUp" && count > 0) {
                index = (index - 1 + count) % count
                publish(latest)
                return true
              }
              if (event.key === "Enter" && count > 0) {
                const item = latest.items[index]
                if (item !== undefined) latest.command(item)
                return true
              }
              return false
            },
            onExit: () => {
              latest = null
              index = 0
              onState(null)
            },
          }
        },
      }),
    ]
  },
})
