import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { CircleCheck, Copy, ExternalLink, Trash2 } from "lucide-react"
import type { Priority } from "@audit/domain/tasks/schema"
import type { BoardId, TaskId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"
import { membersQuery, taskDetailQuery } from "../../lib/queries.ts"
import { taskHref } from "../../lib/entity-links.ts"
import { useBulkAction, useUpdateCard } from "../board/board-mutations.ts"
import type { ActionGroup, EntityAction, EntityTarget } from "./types.ts"
import {
  absoluteHref,
  taskNumberFromKey,
  useCopyText,
  useGo,
  useInvalidateTasks,
  useRunAction,
} from "./shared.ts"

type TaskTarget = Extract<EntityTarget, { kind: "task" }>

/** Placeholder ids for the hooks when there is no target; the hooks never fire without one. */
const NO_TASK = "" as TaskId
const NO_BOARD = "" as BoardId

const PRIORITIES: ReadonlyArray<Priority> = ["none", "low", "medium", "high", "urgent"]

export const useTaskActions = (
  target: TaskTarget | null,
  open: boolean,
): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const go = useGo()
  const copy = useCopyText()
  const invalidate = useInvalidateTasks()
  const run = useRunAction(invalidate)

  const task = target?.task
  const taskId = task?.id ?? NO_TASK
  const boardId = task?.boardId ?? NO_BOARD
  const enabled = open && task !== undefined
  const detail = useQuery({ ...taskDetailQuery(taskId), enabled })
  const members = useQuery({ ...membersQuery, enabled })
  const updateCard = useUpdateCard(boardId)
  const bulk = useBulkAction(boardId)

  if (target === null || task === undefined) return []
  const href = taskHref(task.projectKey, taskNumberFromKey(task.key))
  const columns = target.columns ?? []

  const priorityLabel: Record<Priority, string> = {
    none: t`None`,
    low: t`Low`,
    medium: t`Medium`,
    high: t`High`,
    urgent: t`Urgent`,
  }

  const moveTo: ReadonlyArray<EntityAction> = columns
    .filter((column) => column.id !== task.columnId)
    .map((column) => ({
      id: `move-${column.id}`,
      label: column.name,
      run: () => bulk.mutate({ _tag: "move", taskIds: [task.id], columnId: column.id }),
    }))

  const assignTo: ReadonlyArray<EntityAction> = [
    ...(task.assignees.length > 0
      ? [
          {
            id: "assign-none",
            label: t`Unassigned`,
            run: () => updateCard.mutate({ taskId: task.id, version: task.version, assignees: [] }),
          },
        ]
      : []),
    ...(members.data ?? []).map((member) => ({
      id: `assign-${member.userId}`,
      label: member.displayName,
      run: () =>
        updateCard.mutate({
          taskId: task.id,
          version: task.version,
          assignees: [member.userId],
        }),
    })),
  ]

  const priority: ReadonlyArray<EntityAction> = PRIORITIES.map((value) => ({
    id: `priority-${value}`,
    label: priorityLabel[value],
    disabled: value === task.priority,
    run: () => updateCard.mutate({ taskId: task.id, version: task.version, priority: value }),
  }))

  const watching = detail.data?.watching

  return [
    [
      {
        id: "open",
        label: t`Open`,
        icon: ExternalLink,
        run: () => go(href),
      },
      ...(target.columns === undefined
        ? []
        : [
            {
              id: "move",
              label: t`Move to`,
              disabled: moveTo.length === 0,
              disabledReason: t`No other columns`,
              children: moveTo,
            },
          ]),
      {
        id: "assign",
        label: t`Assign to`,
        pending: members.isPending && enabled,
        children: assignTo,
      },
      { id: "priority", label: t`Priority`, children: priority },
      {
        id: "watch",
        label: watching === true ? t`Unwatch` : t`Watch`,
        pending: detail.isPending && enabled,
        disabled: detail.isPending && enabled,
        run: () =>
          run.mutate(
            () =>
              callApi((api) =>
                watching === true
                  ? api.tasks.unwatch({ params: { taskId: task.id } })
                  : api.tasks.watch({ params: { taskId: task.id } }),
              ),
            {
              onSuccess: () =>
                toast.success(watching === true ? t`Stopped watching` : t`Watching task`),
            },
          ),
      },
    ],
    [
      {
        id: "copy-link",
        label: t`Copy link`,
        icon: Copy,
        run: () => copy(absoluteHref(href), t`Link copied`),
      },
      {
        id: "copy-key",
        label: t`Copy key`,
        icon: CircleCheck,
        run: () => copy(task.key, t`Key copied`),
      },
    ],
    [
      {
        id: "delete",
        label: t`Delete`,
        icon: Trash2,
        variant: "destructive",
        confirm: {
          title: t`Delete “${task.title}”?`,
          description: t`The task will be removed from its board.`,
          confirmLabel: t`Delete`,
        },
        run: () => bulk.mutate({ _tag: "delete", taskIds: [task.id] }),
      },
    ],
  ]
}
