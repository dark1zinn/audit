import type { QueryClient } from "@tanstack/react-query"
import type { BoardId, ProjectId } from "@audit/domain/ids"
import { keys } from "../../lib/queries.ts"

/** Refreshes every cache entry a project-level change can make stale. */
export const invalidateProject = async (
  queryClient: QueryClient,
  projectId: ProjectId,
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.projects }),
    queryClient.invalidateQueries({ queryKey: keys.adminProjects }),
    queryClient.invalidateQueries({ queryKey: keys.project(projectId) }),
    queryClient.invalidateQueries({ queryKey: keys.access(projectId) }),
  ])
}

/** Refreshes the board list of a project and the cached view of one board. */
export const invalidateBoards = async (
  queryClient: QueryClient,
  projectId: ProjectId,
  boardId: BoardId,
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.boards(projectId) }),
    queryClient.invalidateQueries({ queryKey: keys.board(boardId) }),
  ])
}
