import { useEffect, useRef, useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import type { ChannelId, MessageId } from "@audit/domain/ids"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { callApi } from "../../lib/api.ts"
import { chatKeys, messageChangeKeys, threadQuery } from "../../lib/chat.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { Composer } from "./composer.tsx"
import { MessageItem } from "./message-item.tsx"

interface ThreadPanelProps {
  readonly channelId: ChannelId
  readonly rootId: MessageId
  readonly meId: string
}

/** Side panel with one thread: root, latest replies, follow and reply. */
export function ThreadPanel({ channelId, rootId, meId }: ThreadPanelProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const thread = useQuery(threadQuery(rootId))
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastSent = useRef<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  const replies = thread.data?.replies.messages ?? []
  const newest = replies.length > 0 ? replies[replies.length - 1]?.id : thread.data?.root.id
  const readId = thread.data?.lastReadId ?? null

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: chatKeys.thread(rootId) }),
      queryClient.invalidateQueries({ queryKey: chatKeys.threads }),
      ...messageChangeKeys(channelId).map((key) =>
        queryClient.invalidateQueries({ queryKey: key }),
      ),
    ])

  // Monotonic thread read: only the newest reply id is ever sent, and only while visible at the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null || newest === undefined || newest === readId) return
    if (lastSent.current === newest) return
    if (document.visibilityState !== "visible") return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 80) return
    lastSent.current = newest
    void callApi((api) => api.chat.threadMarkRead({ params: { messageId: rootId } }))
      .then(() => queryClient.invalidateQueries({ queryKey: chatKeys.threads }))
      .catch(() => {
        lastSent.current = null
      })
  })

  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [thread.data?.replies.messages.length, rootId])

  const follow = useMutation({
    mutationFn: () =>
      thread.data?.following
        ? callApi((api) => api.chat.unfollowThread({ params: { messageId: rootId } }))
        : callApi((api) => api.chat.followThread({ params: { messageId: rootId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKeys.thread(rootId) }),
    onError: (caught) => setError(caught),
  })

  const createDoc = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.chat.threadToDoc({
          params: { messageId: rootId },
          payload: {
            projectId: null,
            ...(thread.data === undefined
              ? {}
              : { title: thread.data.root.bodyText.slice(0, 120) }),
          },
        }),
      ),
    onSuccess: (created) => {
      if (created.docId === undefined) return
      void navigate({ to: "/docs/$docId", params: { docId: created.docId } })
    },
    onError: (caught) => setError(caught),
  })

  return (
    <aside
      className="flex h-full w-full min-w-0 flex-col border-l bg-background md:w-96"
      aria-label={t`Thread`}
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-semibold">
          <Trans>Thread</Trans>
        </h2>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!thread.isSuccess || follow.isPending}
            onClick={() => follow.mutate()}
          >
            {thread.data?.following ? <Trans>Following</Trans> : <Trans>Follow</Trans>}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!thread.isSuccess || createDoc.isPending}
            onClick={() => createDoc.mutate()}
          >
            <Trans>Create doc</Trans>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t`Close thread`}
            onClick={() => void navigate({ to: "/c/$channelId", params: { channelId } })}
          >
            <X className="size-4" />
          </Button>
        </div>
      </header>
      {thread.isPending ? <LoadingRows /> : null}
      {thread.isError ? <ErrorMessage error={thread.error} /> : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {thread.data === undefined ? null : (
          <>
            <div className="border-b bg-muted/30">
              <MessageItem message={thread.data.root} channelId={channelId} meId={meId} canPin />
            </div>
            <p className="px-4 py-2 text-xs text-muted-foreground">
              <Trans>{replies.length} replies</Trans>
            </p>
            {replies.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                channelId={channelId}
                meId={meId}
                canPin
              />
            ))}
          </>
        )}
      </div>
      <div className="border-t p-3">
        <Composer
          channelId={channelId}
          placeholder={t`Reply in thread`}
          submitLabel={t`Reply`}
          onSubmit={async (body: RichDoc) => {
            await callApi((api) =>
              api.chat.postMessage({
                params: { channelId },
                payload: { body, threadRootId: rootId },
              }),
            )
            await refresh()
          }}
        />
        {error === null ? null : <ErrorMessage error={error} />}
      </div>
    </aside>
  )
}
