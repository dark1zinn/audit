import { useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { ProjectId, TaskId } from "@audit/domain/ids"
import type { TaskDetail, UpdateTaskInput } from "@audit/domain/tasks/schema"
import { roleAtLeast } from "@audit/domain/roles"
import { Avatar, AvatarFallback } from "@audit/ui/components/ui/avatar.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { callApi } from "../../lib/api.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { useRealtimeScopes, usePresence } from "../../lib/realtime.ts"
import { sessionQuery, taskDetailQuery } from "../../lib/queries.ts"
import { ActivitySection } from "./activity.tsx"
import { CommentsSection } from "./comments.tsx"
import { ConflictDialog } from "./conflict-dialog.tsx"
import { Description } from "./description.tsx"
import { invalidateTask } from "./queries.ts"
import { Relations } from "./relations.tsx"
import { Subtasks } from "./subtasks.tsx"
import { TaskFields } from "./task-fields.tsx"
import { useTaskUpdate } from "./use-task-update.ts"

interface TaskPanelProps {
  readonly projectId: ProjectId
  readonly taskId: TaskId
  /** Seed from the number lookup so the page renders without a second round trip. */
  readonly initial?: TaskDetail
}

export function TaskPanel({ projectId, taskId, initial }: TaskPanelProps) {
  const task = useQuery({
    ...taskDetailQuery(taskId),
    ...(initial?.id === taskId ? { initialData: initial } : {}),
  })
  useRealtimeScopes([`entity:${taskId}`])

  if (task.isError) return <ErrorMessage error={task.error} />
  if (task.data === undefined) return <LoadingRows />
  return <TaskView projectId={projectId} task={task.data} />
}

function TaskView({
  projectId,
  task,
}: {
  readonly projectId: ProjectId
  readonly task: TaskDetail
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const me = useQuery(sessionQuery)
  const viewers = usePresence(`entity:${task.id}`, task.id)
  const update = useTaskUpdate(task)

  const watch = useMutation({
    mutationFn: (watching: boolean) =>
      callApi((api) =>
        watching
          ? api.tasks.unwatch({ params: { taskId: task.id } })
          : api.tasks.watch({ params: { taskId: task.id } }),
      ),
    onSuccess: () => invalidateTask(queryClient, task.id),
  })

  const canEdit = roleAtLeast(task.myRole, "editor")
  const canComment = roleAtLeast(task.myRole, "commenter")
  const others = viewers.filter((viewer) => viewer.userId !== me.data?.userId)
  const save = (input: UpdateTaskInput) => update.save(input)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground">{task.key}</p>
            <div className="flex items-center gap-2">
              {others.length > 0 && (
                <ul aria-label={t`Also viewing`} className="flex -space-x-2">
                  {others.map((viewer) => (
                    <li key={viewer.userId}>
                      <Avatar className="size-7 ring-2 ring-background" title={viewer.name}>
                        <AvatarFallback>{initials(viewer.name)}</AvatarFallback>
                      </Avatar>
                      <span className="sr-only">{viewer.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={task.watching}
                disabled={watch.isPending}
                onClick={() => watch.mutate(task.watching)}
              >
                {task.watching ? t`Watching` : t`Watch`}
              </Button>
            </div>
          </div>
          <TitleEditor
            title={task.title}
            canEdit={canEdit}
            disabled={update.pending}
            onSave={(title) => save({ title })}
          />
        </header>

        {update.error !== null && <ErrorMessage error={update.error} />}
        {update.conflict !== null && (
          <ConflictDialog
            conflict={update.conflict}
            onResolve={update.resolve}
            onDismiss={update.dismissConflict}
          />
        )}

        <Description task={task} canEdit={canEdit} disabled={update.pending} onSave={save} />
        <Subtasks task={task} canEdit={canEdit} />
        <Relations task={task} projectId={projectId} canEdit={canEdit} />
        <CommentsSection
          task={task}
          currentUserId={me.data?.userId ?? null}
          canComment={canComment}
        />
        <ActivitySection entries={task.activity} />
      </div>

      <aside className="space-y-6">
        <TaskFields
          task={task}
          projectId={projectId}
          canEdit={canEdit}
          pending={update.pending}
          onSave={save}
        />
      </aside>
    </div>
  )
}

function TitleEditor({
  title,
  canEdit,
  disabled,
  onSave,
}: {
  readonly title: string
  readonly canEdit: boolean
  readonly disabled: boolean
  readonly onSave: (title: string) => void
}) {
  const { t } = useLingui()
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null) {
    return (
      <h1 className="text-2xl font-semibold tracking-tight">
        {canEdit ? (
          <button
            type="button"
            className="rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setDraft(title)}
          >
            {title}
          </button>
        ) : (
          title
        )}
      </h1>
    )
  }
  const commit = () => {
    const next = draft.trim()
    setDraft(null)
    if (next.length > 0 && next !== title) onSave(next)
  }
  return (
    <Input
      ref={(element) => element?.focus()}
      aria-label={t`Title`}
      value={draft}
      maxLength={300}
      disabled={disabled}
      className="h-auto py-1 text-2xl font-semibold"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") setDraft(null)
      }}
    />
  )
}

const initials = (name: string): string =>
  name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase()
