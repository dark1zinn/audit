import { useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { BoardId, ColumnId, LabelId, TaskId, UserId } from "@audit/domain/ids"
import type { BoardView, Priority, TaskCard } from "@audit/domain/tasks/schema"
import { callApi } from "../../lib/api.ts"
import { errorKind } from "../../lib/errors.ts"
import { optimisticMove, placeCard, type MoveRequest } from "./board-model.ts"

/** Prefix matching every cached board view of one board (all query variants). */
const viewsKey = (boardId: BoardId) => ["board", boardId, "view"] as const

export type BulkAction =
  | { readonly _tag: "move"; readonly taskIds: ReadonlyArray<TaskId>; readonly columnId: ColumnId }
  | {
      readonly _tag: "assign"
      readonly taskIds: ReadonlyArray<TaskId>
      readonly add: ReadonlyArray<UserId>
    }
  | {
      readonly _tag: "label"
      readonly taskIds: ReadonlyArray<TaskId>
      readonly add: ReadonlyArray<LabelId>
    }
  | { readonly _tag: "delete"; readonly taskIds: ReadonlyArray<TaskId> }

export interface UpdateCardInput {
  readonly taskId: TaskId
  readonly version: number
  readonly assignees?: ReadonlyArray<UserId>
  readonly labels?: ReadonlyArray<LabelId>
  readonly priority?: Priority
}

export const useMoveTask = (boardId: BoardId) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: MoveRequest) =>
      callApi((api) =>
        api.tasks.move({
          params: { taskId: request.taskId },
          payload: {
            columnId: request.columnId,
            afterTaskId: request.afterTaskId,
            version: request.version,
          },
        }),
      ),
    onMutate: async (request: MoveRequest) => {
      await queryClient.cancelQueries({ queryKey: viewsKey(boardId) })
      const snapshot = queryClient.getQueriesData<BoardView>({ queryKey: viewsKey(boardId) })
      for (const [key, view] of snapshot) {
        if (view !== undefined) queryClient.setQueryData(key, optimisticMove(view, request))
      }
      return { snapshot }
    },
    onSuccess: (card: TaskCard) => {
      for (const [key, view] of queryClient.getQueriesData<BoardView>({
        queryKey: viewsKey(boardId),
      })) {
        if (view !== undefined) queryClient.setQueryData(key, placeCard(view, card))
      }
    },
    onError: (error, _request, context) => {
      for (const [key, view] of context?.snapshot ?? []) {
        if (view !== undefined) queryClient.setQueryData(key, view)
      }
      toast.error(
        errorKind(error) === "conflict"
          ? t`This task changed elsewhere. The board was refreshed.`
          : errorKind(error) === "forbidden"
            ? t`You cannot move this task.`
            : t`Could not move the task.`,
      )
      void queryClient.invalidateQueries({ queryKey: viewsKey(boardId) })
    },
  })
}

export const useUpdateCard = (boardId: BoardId) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateCardInput) =>
      callApi((api) =>
        api.tasks.update({
          params: { taskId: input.taskId },
          payload: {
            version: input.version,
            ...(input.assignees === undefined ? {} : { assignees: [...input.assignees] }),
            ...(input.labels === undefined ? {} : { labels: [...input.labels] }),
            ...(input.priority === undefined ? {} : { priority: input.priority }),
          },
        }),
      ),
    onSuccess: (card: TaskCard) => {
      for (const [key, view] of queryClient.getQueriesData<BoardView>({
        queryKey: viewsKey(boardId),
      })) {
        if (view !== undefined) queryClient.setQueryData(key, placeCard(view, card))
      }
      void queryClient.invalidateQueries({ queryKey: ["task", card.id] })
    },
    onError: (error) => {
      toast.error(
        errorKind(error) === "conflict"
          ? t`This task changed elsewhere. Reload and try again.`
          : t`Could not update the task.`,
      )
      void queryClient.invalidateQueries({ queryKey: viewsKey(boardId) })
    },
  })
}

export const useBulkAction = (boardId: BoardId) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (action: BulkAction) => {
      switch (action._tag) {
        case "move":
          return callApi((api) =>
            api.tasks.bulkMove({
              payload: { taskIds: [...action.taskIds], columnId: action.columnId },
            }),
          )
        case "assign":
          return callApi((api) =>
            api.tasks.bulkAssign({
              payload: { taskIds: [...action.taskIds], add: [...action.add], remove: [] },
            }),
          )
        case "label":
          return callApi((api) =>
            api.tasks.bulkLabel({
              payload: { taskIds: [...action.taskIds], add: [...action.add], remove: [] },
            }),
          )
        case "delete":
          return callApi((api) =>
            api.tasks.bulkDelete({ payload: { taskIds: [...action.taskIds] } }),
          )
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["board", boardId] })
      await queryClient.invalidateQueries({ queryKey: ["tasks"] })
    },
    onError: () => {
      toast.error(t`The bulk action failed. Nothing was changed.`)
    },
  })
}

export const useCreateTask = (boardId: BoardId) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ title, columnId }: { readonly title: string; readonly columnId: ColumnId }) =>
      callApi((api) => api.tasks.create({ params: { boardId }, payload: { title, columnId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: viewsKey(boardId) })
    },
    onError: () => {
      toast.error(t`Could not create the task.`)
    },
  })
}
