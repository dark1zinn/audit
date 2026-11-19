import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import type { TaskDetail, UpdateTaskInput } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { labelsQuery, membersQuery } from "../../lib/queries.ts"
import { toDayString } from "./dates.ts"
import { richText } from "./rich-text.ts"
import type { TaskConflict } from "./use-task-update.ts"

type Field = Exclude<keyof UpdateTaskInput, "version">
type Choice = "mine" | "theirs"

interface ConflictDialogProps {
  readonly conflict: TaskConflict
  readonly onResolve: (patch: UpdateTaskInput) => void
  readonly onDismiss: () => void
}

/**
 * Shown when a save is rejected with 409. Lists each field the user changed next to the
 * server's current value; the user picks per field which side to keep, then re-saves.
 */
export function ConflictDialog({ conflict, onResolve, onDismiss }: ConflictDialogProps) {
  const { t } = useLingui()
  const members = useQuery(membersQuery)
  const labels = useQuery(labelsQuery(conflict.latest.projectId))
  const fields = (Object.keys(conflict.patch) as Field[]).filter(
    (field) => conflict.patch[field] !== undefined,
  )
  const [choices, setChoices] = useState<Record<string, Choice>>({})

  const fieldLabels: Record<Field, string> = {
    title: t`Title`,
    description: t`Description`,
    priority: t`Priority`,
    startAt: t`Start date`,
    dueAt: t`Due date`,
    estimate: t`Estimate`,
    assignees: t`Assignees`,
    labels: t`Labels`,
    parentId: t`Parent`,
  }
  const none = t`None`
  const names = (
    ids: ReadonlyArray<string>,
    source: ReadonlyArray<{
      readonly id?: string
      readonly userId?: string
      readonly name?: string
      readonly displayName?: string
    }>,
  ) =>
    ids
      .map((id) => source.find((item) => item.id === id || item.userId === id))
      .map((item) => item?.name ?? item?.displayName ?? "")
      .filter((name) => name !== "")
      .join(", ") || none

  const describe = (field: Field, value: unknown, source: TaskDetail): string => {
    switch (field) {
      case "title":
        return String(value)
      case "description":
        return value === null ? none : richText(value as TaskDetail["description"]) || none
      case "priority":
        return String(value)
      case "startAt":
      case "dueAt":
        return value instanceof Date ? toDayString(value) : none
      case "estimate":
        return value === null || value === undefined ? none : String(value)
      case "assignees":
        return names(value as ReadonlyArray<string>, members.data ?? [])
      case "labels":
        return names(value as ReadonlyArray<string>, labels.data ?? [])
      case "parentId":
        return source.parentId === null ? none : String(source.parentId)
    }
  }

  const apply = () => {
    const chosen: Record<string, unknown> = {}
    for (const field of fields) {
      if ((choices[field] ?? "mine") === "mine") chosen[field] = conflict.patch[field]
    }
    onResolve(chosen as UpdateTaskInput)
  }

  return (
    <Card role="alert" className="border-destructive">
      <CardHeader>
        <CardTitle>{t`This task changed while you were editing`}</CardTitle>
        <CardDescription>
          {t`Someone else saved a newer version. Choose which version to keep for each field.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((field) => {
          const name = `conflict-${field}`
          const choice = choices[field] ?? "mine"
          const mine = describe(field, conflict.patch[field], conflict.latest)
          const theirs = describe(
            field,
            conflict.latest[field as keyof TaskDetail],
            conflict.latest,
          )
          return (
            <fieldset key={field} className="space-y-2">
              <legend className="text-sm font-medium">{fieldLabels[field]}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label
                  className="flex cursor-pointer gap-2 rounded-md border p-3 has-[:checked]:border-primary"
                  aria-label={`${fieldLabels[field]}: ${mine}`}
                >
                  <input
                    type="radio"
                    name={name}
                    value="mine"
                    checked={choice === "mine"}
                    onChange={() => setChoices({ ...choices, [field]: "mine" })}
                    className="mt-1"
                  />
                  <span className="space-y-1">
                    <span className="block text-xs text-muted-foreground">{t`Your version`}</span>
                    <span className="block break-words">{mine}</span>
                  </span>
                </label>
                <label
                  className="flex cursor-pointer gap-2 rounded-md border p-3 has-[:checked]:border-primary"
                  aria-label={`${fieldLabels[field]}: ${theirs}`}
                >
                  <input
                    type="radio"
                    name={name}
                    value="theirs"
                    checked={choice === "theirs"}
                    onChange={() => setChoices({ ...choices, [field]: "theirs" })}
                    className="mt-1"
                  />
                  <span className="space-y-1">
                    <span className="block text-xs text-muted-foreground">{t`Current version`}</span>
                    <span className="block break-words">{theirs}</span>
                  </span>
                </label>
              </div>
            </fieldset>
          )
        })}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDismiss}>
            {t`Discard my changes`}
          </Button>
          <Button type="button" onClick={apply}>
            {t`Apply choices`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
