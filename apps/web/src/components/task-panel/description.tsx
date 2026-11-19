import { useLingui } from "@lingui/react/macro"
import { useState } from "react"
import type { RichDoc, TaskDetail, UpdateTaskInput } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { RichEditor } from "./rich-editor.tsx"

interface DescriptionProps {
  readonly task: TaskDetail
  readonly canEdit: boolean
  readonly disabled: boolean
  readonly onSave: (patch: UpdateTaskInput) => void
}

export function Description({ task, canEdit, disabled, onSave }: DescriptionProps) {
  const { t } = useLingui()
  const [draft, setDraft] = useState<RichDoc | null>(null)
  const [editing, setEditing] = useState(false)
  // Bumping the epoch remounts the editor so it picks up the starting content.
  const [epoch, setEpoch] = useState(0)

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
        {canEdit && !editing && (
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
