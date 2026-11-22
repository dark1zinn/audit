import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { Message, ThreadSummary } from "@audit/domain/chat/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { savedQuery, threadsQuery } from "../../lib/chat.ts"
import { ErrorMessage, LoadingRows, PageHeader } from "../feedback.tsx"
import { MessageBody } from "./message-body.tsx"
import { messageHref } from "../../lib/entity-links.ts"
import { formatMessageTime } from "./format-time.ts"

const rowClass = "block rounded-md border p-3 hover:bg-accent"

/** Threads you follow, with unread reply counts. */
export function ThreadsView() {
  const { t, i18n } = useLingui()
  const threads = useQuery(threadsQuery)
  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <PageHeader title={t`Threads`} />
      {threads.isPending ? <LoadingRows /> : null}
      {threads.isError ? <ErrorMessage error={threads.error} /> : null}
      {threads.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>You are not following any threads yet.</Trans>
        </p>
      ) : null}
      <ul className="space-y-2">
        {threads.data?.map((thread: ThreadSummary) => (
          <li key={thread.root.id}>
            <Link to={messageHref(thread.root.channelId, thread.root.id)} className={rowClass}>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">#{thread.channelName}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span>{t`${thread.root.replyCount} replies`}</span>
                  {thread.lastReplyAt === null ? null : (
                    <time dateTime={String(thread.lastReplyAt)}>
                      {formatMessageTime(thread.lastReplyAt, i18n.locale, "short")}
                    </time>
                  )}
                  {thread.unreadReplies > 0 ? (
                    <Badge variant="secondary">{thread.unreadReplies}</Badge>
                  ) : null}
                </span>
              </div>
              <p className="line-clamp-2 text-sm">{thread.root.bodyText}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Messages saved by you, newest first. */
export function SavedView() {
  const { t, i18n } = useLingui()
  const saved = useQuery(savedQuery)
  return (
    <section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <PageHeader title={t`Saved messages`} />
      {saved.isPending ? <LoadingRows /> : null}
      {saved.isError ? <ErrorMessage error={saved.error} /> : null}
      {saved.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Save a message to find it here later.</Trans>
        </p>
      ) : null}
      <ul className="space-y-2">
        {saved.data?.map((message: Message) => (
          <li key={message.id}>
            <div className={rowClass}>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <Link
                  to="/c/$channelId"
                  params={{ channelId: message.channelId }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {message.author.name}
                </Link>
                <time dateTime={String(message.createdAt)}>
                  {formatMessageTime(message.createdAt, i18n.locale, "short")}
                </time>
              </div>
              <MessageBody body={message.body} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
