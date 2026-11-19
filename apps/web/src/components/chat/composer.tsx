import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useLingui } from "@lingui/react/macro"
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react"
import { Paperclip, Send } from "lucide-react"
import type { ChannelId } from "@audit/domain/ids"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { baseExtensions } from "../docs/editor-extensions.ts"
import { emptyDoc } from "../task-panel/rich-text.ts"
import { uploadFile } from "../../lib/upload.ts"
import { ErrorMessage } from "../feedback.tsx"
import { MentionSuggest, type MentionCandidate, type MentionState } from "./mention-suggest.ts"

const TYPING_REFRESH_MS = 2000

/** True when the document has no text and no embedded content. */
export const isBlankDoc = (doc: RichDoc): boolean => {
  const walk = (node: unknown): boolean => {
    if (typeof node !== "object" || node === null) return true
    const record = node as { type?: unknown; text?: unknown; content?: unknown }
    if (record.type === "image" || record.type === "fileAttachment") return false
    if (typeof record.text === "string" && record.text.trim() !== "") return false
    return !Array.isArray(record.content) || record.content.every(walk)
  }
  return walk(doc)
}

interface ComposerProps {
  readonly channelId: ChannelId
  readonly candidates: ReadonlyArray<MentionCandidate>
  readonly placeholder: string
  readonly submitLabel: string
  readonly onSubmit: (body: RichDoc) => Promise<void>
  readonly onTyping?: (typing: boolean) => void
  readonly onCancel?: () => void
  readonly initial?: RichDoc
}

/** Chat message composer. Enter sends, Shift+Enter inserts a newline, `@` opens the people picker. */
export function Composer({
  channelId,
  candidates,
  placeholder,
  submitLabel,
  onSubmit,
  onTyping,
  onCancel,
  initial,
}: ComposerProps) {
  const { t } = useLingui()
  const [mention, setMention] = useState<MentionState | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const readCandidates = useEffectEvent(() => candidates)
  const onMentionState = useEffectEvent((state: MentionState | null) => {
    mentionOpen.current = state !== null
    setMention(state)
  })
  const typingAt = useRef(0)
  const mentionOpen = useRef(false)
  const submitRef = useRef<() => void>(() => undefined)

  const editor = useEditor({
    extensions: [
      ...baseExtensions,
      MentionSuggest.configure({
        candidates: readCandidates,
        onState: onMentionState,
      }),
    ],
    content: (initial ?? emptyDoc) as JSONContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": placeholder,
        class:
          "min-h-10 max-h-48 overflow-y-auto px-3 py-2 text-sm outline-none whitespace-pre-wrap",
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Enter" || event.shiftKey || mentionOpen.current) return false
        event.preventDefault()
        submitRef.current()
        return true
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (onTyping === undefined) return
      if (isBlankDoc(instance.getJSON() as RichDoc)) {
        typingAt.current = 0
        onTyping(false)
        return
      }
      const now = Date.now()
      if (now - typingAt.current < TYPING_REFRESH_MS) return
      typingAt.current = now
      onTyping(true)
    },
  })

  const submit = async () => {
    if (editor === null || busy) return
    const doc = editor.getJSON() as RichDoc
    if (isBlankDoc(doc)) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(doc)
      editor.commands.clearContent(true)
      typingAt.current = 0
      onTyping?.(false)
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    submitRef.current = () => void submit()
  })

  const attach = async (file: File) => {
    if (editor === null) return
    setError(null)
    try {
      const ref = await uploadFile(file, channelId)
      const node = ref.mime.startsWith("image/")
        ? { type: "image", attrs: { src: `/files/${ref.id}`, alt: ref.name } }
        : { type: "fileAttachment", attrs: { fileId: ref.id, name: ref.name, size: ref.size } }
      editor.chain().focus().insertContent(node).insertContent(" ").run()
    } catch (caught) {
      setError(caught)
    }
  }

  return (
    <div className="space-y-1">
      {mention !== null && mention.items.length > 0 ? (
        <MentionMenu state={mention} label={t`People`} />
      ) : null}
      <div className="rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
        <EditorContent editor={editor} />
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1">
          <div className="flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file !== undefined) void attach(file)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t`Attach file`}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {onCancel === undefined ? null : (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                {t`Cancel`}
              </Button>
            )}
            <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
              <Send className="size-4" />
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
      {error === null ? null : <ErrorMessage error={error} />}
    </div>
  )
}

function MentionMenu({ state, label }: { readonly state: MentionState; readonly label: string }) {
  return (
    <ul
      aria-label={label}
      className="max-h-56 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md"
    >
      {state.items.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            data-active={index === state.index}
            className={`w-full rounded px-2 py-1 text-left ${index === state.index ? "bg-accent" : ""}`}
            onMouseDown={(event) => {
              event.preventDefault()
              state.select(item)
            }}
          >
            @{item.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
