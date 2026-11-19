import type { QueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import type { ProjectId, TaskId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"

export const taskByNumberQuery = (projectId: ProjectId, number: number) =>
  queryOptions({
    queryKey: ["task", "by-number", projectId, number] as const,
    queryFn: () => callApi((api) => api.tasks.byNumber({ params: { projectId, number } })),
  })

export const subtasksQuery = (taskId: TaskId) =>
  queryOptions({
    queryKey: ["task", taskId, "subtasks"] as const,
    queryFn: () => callApi((api) => api.tasks.subtasks({ params: { taskId } })),
  })

/** Refreshes the task and the list-like views that show it. Mirrors the realtime invalidation set. */
export const invalidateTask = (queryClient: QueryClient, taskId: TaskId) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
    queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    queryClient.invalidateQueries({ queryKey: ["board"] }),
    queryClient.invalidateQueries({ queryKey: ["calendar"] }),
    queryClient.invalidateQueries({ queryKey: ["mine"] }),
  ])
