import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { notificationsQuery } from "../../lib/queries.ts"

const navLinkClass =
  "flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"

/** Sidebar link to the inbox. The badge counts unread, unarchived notifications. */
export function InboxNavLink() {
  const { t } = useLingui()
  const inbox = useQuery(notificationsQuery(false))
  const unread = inbox.data?.filter((item) => item.readAt === null).length ?? 0

  return (
    <Link
      to="/inbox"
      className={navLinkClass}
      activeProps={{ className: `${navLinkClass} bg-accent text-foreground` }}
    >
      <span>
        <Trans>Inbox</Trans>
      </span>
      {unread > 0 && (
        <span
          aria-label={t`${unread} unread`}
          className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-medium text-primary-foreground"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  )
}
