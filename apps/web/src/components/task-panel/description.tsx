import { useLingui } from "@lingui/react/macro"
import { FileText } from "lucide-react"
import { useState } from "react"
import type { RichDoc, TaskDetail, UpdateTaskInput } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { EmptyState } from "../feedback.tsx"
import { RichEditor } from "./rich-editor.tsx"

interface DescriptionProps {
  readonly task: TaskDetail
  readonly canEdit: boolean
  readonly disabled: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}

/** True when the rich document has no text and no embedded content. */
const isBlank = (node: unknown): boolean => {
  if (typeof node !== "object" || node === null) return true
  const record = node as { type?: unknown; text?: unknown; content?: unknown }
  if (record.type === "image" || record.type === "fileAttachment") return false
  if (typeof record.text === "string" && record.text.trim() !== "") return false
  return !Array.isArray(record.content) || record.content.every(isBlank)
}

export function Description({ task, canEdit, disabled, onSave }: DescriptionProps) {
  const { t } = useLingui()
  const [draft, setDraft] = useState<RichDoc | null>(null)
  const [editing, setEditing] = useState(false)
  // Bumping the epoch remounts the editor so it picks up the starting content.
  const [epoch, setEpoch] = useState(0)
  const blank = isBlank(task.description)

  const startEditing = () => {
    setDraft(task.description)
    setEpoch((value) => value + 1)
    setEditing(true)
  }

  const stopEditing = () => {
    setDraft(null)
    setEditing(false)
  }

  const save = () => {
    if (draft === null) return stopEditing()
    onSave({ description: draft })
    stopEditing()
  }

  return (
    <section aria-labelledby="task-description-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="task-description-heading" className="text-base font-semibold">
          {t`Description`}
        </h2>
        {canEdit && !editing && !blank && (
          <Button type="button" variant="outline" size="sm" onClick={startEditing}>
            {t`Edit description`}
          </Button>
        )}
        {editing && (
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={stopEditing}>
              {t`Cancel`}
            </Button>
            <Button type="button" size="sm" disabled={disabled} onClick={save}>
              {t`Save description`}
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <RichEditor
          key={epoch}
          value={task.description}
          editable
          label={t`Description`}
          onChange={setDraft}
        />
      ) : blank ? (
        <div className="flex flex-wrap items-center gap-3">
          <EmptyState size="sm" icon={FileText} title={t`No description yet.`} />
          {canEdit && (
            <Button type="button" variant="outline" size="sm" onClick={startEditing}>
              {t`Add a description…`}
            </Button>
          )}
        </div>
      ) : (
        <RichEditor
          key={task.version}
          value={task.description}
          editable={false}
          label={t`Description`}
        />
      )}
    </section>
  )
}
