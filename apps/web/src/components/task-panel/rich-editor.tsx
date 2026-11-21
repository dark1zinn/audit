import { EditorContent, useEditor } from "@tiptap/react"
import { baseExtensions } from "../docs/editor-extensions.ts"
import type { JSONContent } from "@tiptap/react"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { emptyDoc } from "./rich-text.ts"
import { MentionShortcuts } from "../mentions/mention-shortcuts.ts"
import { MentionPickerMenu, useMentionPicker } from "../mentions/mention-picker-menu.tsx"
import { RichToolbar } from "../editor/rich-toolbar.tsx"

interface RichEditorProps {
  readonly value: RichDoc | null
  readonly editable: boolean
  readonly label: string
  readonly onChange?: (doc: RichDoc) => void
}

/** Tiptap editor with a minimal, keyboard-operable toolbar. Content is read once at mount. */
export function RichEditor({ value, editable, label, onChange }: RichEditorProps) {
  const picker = useMentionPicker()
  const editor = useEditor({
    extensions: [...baseExtensions, picker.extension, MentionShortcuts],
    content: (value ?? emptyDoc) as JSONContent,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": label },
    },
    onUpdate: ({ editor: instance }) => {
      if (onChange === undefined) return
      const doc: RichDoc = { ...instance.getJSON() }
      onChange(doc)
    },
  })

  if (editor === null) return null

  return (
    <div className="rounded-md border bg-background">
      <MentionPickerMenu picker={picker} />
      {editable && <RichToolbar editor={editor} label={label} />}
      <EditorContent editor={editor} className="prose prose-sm max-w-none px-3 py-2" />
    </div>
  )
}
