import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { TaskDetail, UpdateTaskInput } from "@audit/domain/tasks/schema"
import { callApi } from "../../lib/api.ts"
import { errorKind } from "../../lib/errors.ts"
import { taskDetailQuery } from "../../lib/queries.ts"
import { invalidateTask } from "./queries.ts"

/** A rejected (409) patch plus the server's current copy of the task. */
export interface TaskConflict {
  readonly patch: UpdateTaskInput
  readonly latest: TaskDetail
}

export const useTaskUpdate = (task: TaskDetail) => {
  const queryClient = useQueryClient()
  const [conflict, setConflict] = useState<TaskConflict | null>(null)

  const mutation = useMutation({
    mutationFn: (input: { readonly patch: UpdateTaskInput; readonly version: number }) =>
      callApi((api) =>
        api.tasks.update({
          params: { taskId: task.id },
          payload: { ...input.patch, version: input.version },
        }),
      ),
    onSuccess: () => {
      setConflict(null)
      return invalidateTask(queryClient, task.id)
    },
    onError: async (error, input) => {
      if (errorKind(error) !== "conflict") return
      const latest = await queryClient.fetchQuery({ ...taskDetailQuery(task.id), staleTime: 0 })
      setConflict({ patch: input.patch, latest })
    },
  })

  return {
    conflict,
    pending: mutation.isPending,
    error:
      mutation.error !== null && errorKind(mutation.error) !== "conflict" ? mutation.error : null,
    save: (patch: UpdateTaskInput) => mutation.mutate({ patch, version: task.version }),
    /** Re-sends the chosen fields against the server's version. */
    resolve: (patch: UpdateTaskInput) => {
      if (conflict === null) return
      setConflict(null)
      mutation.mutate({ patch, version: conflict.latest.version })
    },
    dismissConflict: () => setConflict(null),
  }
}
