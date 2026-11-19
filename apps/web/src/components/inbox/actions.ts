import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Notification } from "@audit/domain/notifications/schema"
import { callApi } from "../../lib/api.ts"
import { keys } from "../../lib/queries.ts"

/** Inbox writes. Each one refetches the inbox; realtime does the same for other tabs. */
export const useInboxActions = () => {
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.notifications }),
  })

  const setRead = (items: ReadonlyArray<Notification>, read: boolean) =>
    run.mutateAsync(() =>
      Promise.all(
        items.map((item) =>
          callApi((api) =>
            read
              ? api.notifications.read({ params: { notificationId: item.id } })
              : api.notifications.unread({ params: { notificationId: item.id } }),
          ),
        ),
      ),
    )

  const setArchived = (items: ReadonlyArray<Notification>, archived: boolean) =>
    run.mutateAsync(() =>
      Promise.all(
        items.map((item) =>
          callApi((api) =>
            archived
              ? api.notifications.archive({ params: { notificationId: item.id } })
              : api.notifications.unarchive({ params: { notificationId: item.id } }),
          ),
        ),
      ),
    )

  const readAll = () => run.mutateAsync(() => callApi((api) => api.notifications.readAll()))

  return { setRead, setArchived, readAll, pending: run.isPending, error: run.error }
}
