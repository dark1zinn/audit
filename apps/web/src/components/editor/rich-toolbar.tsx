import { useLingui } from "@lingui/react/macro"
import { useEditorState, type Editor } from "@tiptap/react"
import { Bold, Italic, List, ListChecks, ListOrdered } from "lucide-react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Tooltip, TooltipContent, TooltipTrigger } from "@audit/ui/components/ui/tooltip.tsx"

interface RichToolbarProps {
  readonly editor: Editor
  readonly label: string
}

/** Icon toolbar for the shared rich-text editors. Each button has a name and a tooltip. */
export function RichToolbar({ editor, label }: RichToolbarProps) {
  const { t } = useLingui()
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      bulletList: instance.isActive("bulletList"),
      orderedList: instance.isActive("orderedList"),
      taskList: instance.isActive("taskList"),
    }),
  })

  const items = [
    {
      key: "bold",
      name: t`Bold`,
      icon: Bold,
      pressed: active.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      name: t`Italic`,
      icon: Italic,
      pressed: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: "bulletList",
      name: t`Bullet list`,
      icon: List,
      pressed: active.bulletList,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: "orderedList",
      name: t`Numbered list`,
      icon: ListOrdered,
      pressed: active.orderedList,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: "taskList",
      name: t`Checklist`,
      icon: ListChecks,
      pressed: active.taskList,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
  ]

  return (
    <div role="toolbar" aria-label={label} className="flex flex-wrap gap-1 border-b p-1">
      {items.map((item) => (
        <Tooltip key={item.key}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant={item.pressed ? "secondary" : "ghost"}
              aria-label={item.name}
              aria-pressed={item.pressed}
              onClick={item.run}
            >
              <item.icon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{item.name}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
