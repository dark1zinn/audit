import { Trans, useLingui } from "@lingui/react/macro"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ChannelId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Card, CardContent } from "@audit/ui/components/ui/card.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { adminChannelQuery, adminMessagesQuery } from "../lib/chat.ts"

export const Route = createFileRoute("/_app/admin/channels/$channelId")({
  component: AdminChannelPage,
})

/**
 * Read-only view of a channel the administrator is not a member of (private channels and DMs),
 * reached from a member's row on the members page.
 */
function AdminChannelPage() {
  const { t, i18n } = useLingui()
  const channelId = Route.useParams().channelId as ChannelId
  const header = useQuery(adminChannelQuery(channelId))
  const timeline = useInfiniteQuery(adminMessagesQuery(channelId))
  const stamp = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" })

  const summary = header.data?.channel
  const title =
    summary === undefined
      ? t`Channel`
      : summary.name !== ""
        ? summary.name
        : summary.people.map((person) => person.name).join(", ")
  const messages = timeline.data?.pages.flatMap((page) => page.messages) ?? []

  return (
    <>
      <PageHeader title={title} description={t`Viewing as an administrator. Read-only.`} />
      {header.isPending && <LoadingRows rows={1} />}
      {header.isError && <ErrorMessage error={header.error} />}
      {timeline.isPending && <LoadingRows />}
      {timeline.isError && <ErrorMessage error={timeline.error} />}
      {timeline.data !== undefined && (
        <div className="space-y-4">
          {timeline.hasPreviousPage && (
            <Button
              variant="outline"
              size="sm"
              disabled={timeline.isFetchingPreviousPage}
              onClick={() => timeline.fetchPreviousPage()}
            >
              <Trans>Load older messages</Trans>
            </Button>
          )}
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              <Trans>No messages yet.</Trans>
            </p>
          )}
          <ol className="space-y-3">
            {messages.map((message) => (
              <li key={message.id}>
                <Card>
                  <CardContent className="space-y-1 pt-6">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{message.author.name}</span>
                      <time dateTime={message.createdAt.toISOString()}>
                        {stamp.format(message.createdAt)}
                      </time>
                    </div>
                    {message.deletedAt === null ? (
                      <p className="whitespace-pre-wrap text-sm">{message.bodyText}</p>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">
                        <Trans>Message deleted</Trans>
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  )
}
