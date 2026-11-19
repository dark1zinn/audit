import { Extension } from "@tiptap/core"
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion"

/** A person that `@` can mention in the current channel. */
export interface MentionCandidate {
  readonly id: string
  readonly label: string
}

/** What the `@` picker renders. `null` means the picker is closed. */
export interface MentionState {
  readonly items: ReadonlyArray<MentionCandidate>
  readonly index: number
  readonly rect: DOMRect | null
  readonly select: (candidate: MentionCandidate) => void
}

interface MentionOptions {
  readonly candidates: () => ReadonlyArray<MentionCandidate>
  readonly onState: (state: MentionState | null) => void
}

/** Opens the `@` people picker; inserts the shared `mention` node on selection. */
export const MentionSuggest = Extension.create<MentionOptions>({
  name: "mentionSuggest",

  addOptions() {
    return { candidates: () => [], onState: () => undefined }
  },

  addProseMirrorPlugins() {
    const { candidates, onState } = this.options
    return [
      Suggestion<MentionCandidate, MentionCandidate>({
        editor: this.editor,
        char: "@",
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => {
          const needle = query.toLowerCase()
          return candidates()
            .filter((candidate) => candidate.label.toLowerCase().includes(needle))
            .slice(0, 8)
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "mention", attrs: { id: props.id, type: "user", label: props.label } },
              { type: "text", text: " " },
            ])
            .run()
        },
        render: () => {
          let latest: SuggestionProps<MentionCandidate, MentionCandidate> | null = null
          let index = 0
          const publish = (props: SuggestionProps<MentionCandidate, MentionCandidate>) => {
            latest = props
            onState({
              items: props.items,
              index,
              rect: props.clientRect?.() ?? null,
              select: (candidate) => props.command(candidate),
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
              if (latest === null || latest.items.length === 0) return false
              const count = latest.items.length
              if (event.key === "ArrowDown") {
                index = (index + 1) % count
                publish(latest)
                return true
              }
              if (event.key === "ArrowUp") {
                index = (index - 1 + count) % count
                publish(latest)
                return true
              }
              if (event.key === "Enter" || event.key === "Tab") {
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
