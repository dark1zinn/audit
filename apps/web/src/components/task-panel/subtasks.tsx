import { useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ListChecks } from "lucide-react"
import { useState } from "react"
import type { TaskCard, TaskDetail } from "@audit/domain/tasks/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { callApi } from "../../lib/api.ts"
import { fieldWidth } from "../form.tsx"
import { EmptyState, ErrorMessage, LoadingRows } from "../feedback.tsx"
import { invalidateTask, subtasksQuery } from "./queries.ts"

/** The trailing number of a human key such as `OPS-42`. */
const numberOf = (key: string): string => key.slice(key.lastIndexOf("-") + 1)

export function Subtasks({
  task,
  canEdit,
}: {
  readonly task: TaskDetail
  readonly canEdit: boolean
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const subtasks = useQuery(subtasksQuery(task.id))
  const [title, setTitle] = useState("")

  const create = useMutation({
    mutationFn: (value: string) =>
      callApi((api) =>
        api.tasks.create({
          params: { boardId: task.boardId },
          payload: { title: value, parentId: task.id },
        }),
      ),
    onSuccess: async () => {
      setTitle("")
      await queryClient.invalidateQueries({ queryKey: subtasksQuery(task.id).queryKey })
      await invalidateTask(queryClient, task.id)
    },
  })

  return (
    <section aria-labelledby="task-subtasks-heading" className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 id="task-subtasks-heading" className="text-base font-semibold">
          {t`Subtasks`}
        </h2>
        <span className="text-sm text-muted-foreground">
          {t`${task.subtasksDone} of ${task.subtaskCount} done`}
        </span>
      </div>
      {subtasks.isPending && <LoadingRows />}
      {subtasks.isError && <ErrorMessage error={subtasks.error} />}
      {subtasks.data !== undefined && subtasks.data.length === 0 && (
        <EmptyState size="sm" icon={ListChecks} title={t`No subtasks yet.`} />
      )}
      {subtasks.data !== undefined && subtasks.data.length > 0 && (
        <ul className="divide-y rounded-md border">
          {subtasks.data.map((child: TaskCard) => (
            <li key={child.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <Link
                to="/p/$key/t/$number"
                params={{ key: child.projectKey, number: numberOf(child.key) }}
                className="min-w-0 truncate rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="mr-2 font-mono text-xs text-muted-foreground">{child.key}</span>
                {child.title}
              </Link>
              <Badge variant={child.columnCategory === "done" ? "default" : "outline"}>
                {child.columnCategory === "done" ? t`Done` : t`Open`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const value = title.trim()
            if (value.length === 0) return
            create.mutate(value)
          }}
        >
          <Input
            className={fieldWidth.md}
            aria-label={t`New subtask title`}
            value={title}
            maxLength={300}
            placeholder={t`Add a subtask`}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={create.isPending}>
            {t`Add subtask`}
          </Button>
        </form>
      )}
      {create.error !== null && <ErrorMessage error={create.error} />}
    </section>
  )
}
