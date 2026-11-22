import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { Inbox } from "lucide-react"
import { t as tMacro } from "@lingui/core/macro"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { useInboxActions } from "../components/inbox/actions.ts"
import { InboxList } from "../components/inbox/inbox-list.tsx"
import {
  EmptyState,
  ErrorMessage,
  LoadingRows,
  PageBody,
  PageHeader,
} from "../components/feedback.tsx"
import { notificationsQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/inbox")({
  staticData: { crumb: () => ({ label: tMacro`Inbox` }) },
  component: InboxPage,
})

type Filter = "all" | "unread" | "read" | "archived"

function InboxPage() {
  const { t } = useLingui()
  const [filter, setFilter] = useState<Filter>("all")
  const archived = filter === "archived"
  const inbox = useQuery(notificationsQuery(archived))
  const actions = useInboxActions()

  const visible = useMemo(() => {
    const items = inbox.data ?? []
    if (filter === "unread") return items.filter((item) => item.readAt === null)
    if (filter === "read") return items.filter((item) => item.readAt !== null)
    return items
  }, [inbox.data, filter])

  const unread = (inbox.data ?? []).filter((item) => item.readAt === null).length

  const filters: ReadonlyArray<{ readonly id: Filter; readonly label: string }> = [
    { id: "all", label: t`All` },
    { id: "unread", label: t`Unread` },
    { id: "read", label: t`Read` },
    { id: "archived", label: t`Archived` },
  ]

  return (
    <PageBody width="wide">
      <PageHeader
        title={t`Inbox`}
        description={t`Mentions, assignments, due dates, and replies that concern you.`}
        actions={
          <Button
            variant="outline"
            onClick={() => void actions.readAll()}
            disabled={unread === 0 || actions.pending}
          >
            <Trans>Mark all read</Trans>
          </Button>
        }
      />
      <fieldset className="mb-4 flex flex-wrap gap-2">
        <legend className="sr-only">
          <Trans>Filter</Trans>
        </legend>
        {filters.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={filter === option.id ? "default" : "outline"}
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </fieldset>
      {inbox.isError && <ErrorMessage error={inbox.error} />}
      {inbox.data === undefined && !inbox.isError && <LoadingRows />}
      {inbox.data !== undefined && visible.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={archived ? t`No archived notifications.` : t`You are all caught up.`}
          {...(archived ? {} : { description: t`New mentions and assignments will show up here.` })}
        />
      )}
      {inbox.data !== undefined && visible.length > 0 && (
        <InboxList notifications={visible} archived={archived} />
      )}
    </PageBody>
  )
}
