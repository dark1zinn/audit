import { useQuery } from "@tanstack/react-query"
import { notificationsQuery } from "../../lib/queries.ts"

/** Unread, unarchived notifications; shared by the sidebar, the tab bar and the home page. */
export function useInboxUnreadCount(): number {
  const inbox = useQuery(notificationsQuery(false))
  return inbox.data?.filter((item) => item.readAt === null).length ?? 0
}
