import { useLingui } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, MailOpen, Mail, ExternalLink } from "lucide-react"
import type { NotificationId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"
import { keys } from "../../lib/queries.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { useRunAction } from "./shared.ts"

type NotificationTarget = Extract<EntityTarget, { kind: "notification" }>

export const useNotificationActions = (
  target: NotificationTarget | null,
): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const run = useRunAction(() => queryClient.invalidateQueries({ queryKey: keys.notifications }))
  if (target === null) return []
  // With `items` (a bulk selection) the group applies to every item; a state flips
  // only when all items are in it, so one click never splits a selection.
  const items = target.items ?? [target.notification]
  const read = items.every((item) => item.readAt !== null)
  const archived = items.every((item) => item.archivedAt !== null)

  return [
    [
      { id: "open", label: t`Open`, icon: ExternalLink, run: target.onOpen },
      {
        id: "toggle-read",
        label: read ? t`Mark as unread` : t`Mark as read`,
        icon: read ? Mail : MailOpen,
        run: () =>
          run.mutate(() =>
            Promise.all(
              items.map((item) => {
                const notificationId = item.id as NotificationId
                return read
                  ? callApi((api) => api.notifications.unread({ params: { notificationId } }))
                  : callApi((api) => api.notifications.read({ params: { notificationId } }))
              }),
            ),
          ),
      },
      {
        id: "toggle-archive",
        label: archived ? t`Unarchive` : t`Archive`,
        icon: archived ? ArchiveRestore : Archive,
        run: () =>
          run.mutate(() =>
            Promise.all(
              items.map((item) => {
                const notificationId = item.id as NotificationId
                return archived
                  ? callApi((api) => api.notifications.unarchive({ params: { notificationId } }))
                  : callApi((api) => api.notifications.archive({ params: { notificationId } }))
              }),
            ),
          ),
      },
    ],
  ]
}
