import { useLingui } from "@lingui/react/macro"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import type { JSONContent } from "@tiptap/react"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { emptyDoc } from "./rich-text.ts"

const extensions = [StarterKit, TaskList, TaskItem.configure({ nested: true })]

interface RichEditorProps {
  readonly value: RichDoc | null
  readonly editable: boolean
  readonly label: string
  readonly onChange?: (doc: RichDoc) => void
}

/** Tiptap editor with a minimal, keyboard-operable toolbar. Content is read once at mount. */
export function RichEditor({ value, editable, label, onChange }: RichEditorProps) {
  const { t } = useLingui()
  const editor = useEditor({
    extensions,
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

  const activeState = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance?.isActive("bold") ?? false,
      italic: instance?.isActive("italic") ?? false,
      bulletList: instance?.isActive("bulletList") ?? false,
      orderedList: instance?.isActive("orderedList") ?? false,
      taskList: instance?.isActive("taskList") ?? false,
    }),
  })
  const active = activeState ?? {
    bold: false,
    italic: false,
    bulletList: false,
    orderedList: false,
    taskList: false,
  }

  if (editor === null) return null

  return (
    <div className="rounded-md border bg-background">
      {editable && (
        <div role="toolbar" aria-label={label} className="flex flex-wrap gap-1 border-b p-1">
          <Button
            type="button"
            size="sm"
            variant={active.bold ? "secondary" : "ghost"}
            aria-pressed={active.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <span className="font-bold">{t`B`}</span>
            <span className="sr-only">{t`Bold`}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={active.italic ? "secondary" : "ghost"}
            aria-pressed={active.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <span className="italic">{t`I`}</span>
            <span className="sr-only">{t`Italic`}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={active.bulletList ? "secondary" : "ghost"}
            aria-pressed={active.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            {t`Bullet list`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={active.orderedList ? "secondary" : "ghost"}
            aria-pressed={active.orderedList}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            {t`Numbered list`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={active.taskList ? "secondary" : "ghost"}
            aria-pressed={active.taskList}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            {t`Checklist`}
          </Button>
        </div>
      )}
      <EditorContent editor={editor} className="prose prose-sm max-w-none px-3 py-2" />
    </div>
  )
}
