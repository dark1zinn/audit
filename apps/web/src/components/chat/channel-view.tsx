import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useNavigate, useParams } from "@tanstack/react-router"
import { MessagesSquare, Pin, Settings } from "lucide-react"
import type { Message } from "@audit/domain/chat/schema"
import type { ChannelId } from "@audit/domain/ids"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { callApi } from "../../lib/api.ts"
import { channelQuery, chatKeys, messageChangeKeys, messagesQuery } from "../../lib/chat.ts"
import { sendTyping, usePresence, useRealtimeScopes } from "../../lib/realtime.ts"
import { EmptyState, ErrorMessage, LoadingRows } from "../feedback.tsx"
import { Composer } from "./composer.tsx"
import { MessageItem } from "./message-item.tsx"
import { ChannelSettingsDialog, MessageToTaskDialog, PinsDialog } from "./dialogs.tsx"
import { typingLabel } from "./typing.ts"
import { channelTitle } from "./channel-title.ts"
import { useRecordRecent } from "../../lib/search.ts"
import { ChannelAiMenu } from "./channel-ai-menu.tsx"
import { useAiPageContext } from "../ai/ai-store.ts"

/** Turns plain text into one composer paragraph per line. */
const paragraphDoc = (text: string): RichDoc => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: line === "" ? [] : [{ type: "text", text: line }],
  })),
})

type Row =
  | { readonly kind: "divider" }
  | { readonly kind: "day"; readonly label: string }
  | { readonly kind: "message"; readonly message: Message }

interface DayLabels {
  readonly today: string
  readonly yesterday: string
  readonly locale: string
}

/** Calendar-day label: Today, Yesterday, or the localized full date. */
const dayLabel = (date: Date, now: Date, labels: DayLabels): string => {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === now.toDateString()) return labels.today
  if (date.toDateString() === yesterday.toDateString()) return labels.yesterday
  return new Intl.DateTimeFormat(labels.locale, { dateStyle: "full" }).format(date)
}

/** Day separators at each calendar-day change; divider goes before the first message after `lastReadId`, or at the top with no read marker. */
const buildRows = (
  messages: ReadonlyArray<Message>,
  lastReadId: string | null,
  labels: DayLabels,
): Row[] => {
  if (messages.length === 0) return []
  const index = lastReadId === null ? -1 : messages.findIndex((m) => m.id === lastReadId)
  const dividerAt = lastReadId !== null && index === messages.length - 1 ? -1 : index + 1
  const now = new Date()
  const rows: Row[] = []
  let previousDay: string | null = null
  messages.forEach((message, position) => {
    if (position === dividerAt) rows.push({ kind: "divider" })
    const date = new Date(message.createdAt)
    const day = date.toDateString()
    if (day !== previousDay) {
      rows.push({ kind: "day", label: dayLabel(date, now, labels) })
      previousDay = day
    }
    rows.push({ kind: "message", message })
  })
  return rows
}

interface ChannelViewProps {
  readonly channelId: ChannelId
  readonly meId: string
}

/** A channel: header, timeline, typing indicator and composer. */
export function ChannelView({ channelId, meId }: ChannelViewProps) {
  const { t, i18n } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const activeThreadId = useParams({ strict: false, select: (params) => params.threadId })
  const scope = `channel:${channelId}`
  useRecordRecent(channelId)
  useRealtimeScopes([scope])

  const header = useQuery(channelQuery(channelId))
  const messages = useInfiniteQuery(messagesQuery(channelId))
  const viewers = usePresence(scope)
  const [dialog, setDialog] = useState<"settings" | "pins" | null>(null)
  const [taskFrom, setTaskFrom] = useState<Message | null>(null)
  const [anchor, setAnchor] = useState<{ channelId: string; lastRead: string | null } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [draft, setDraft] = useState<{ key: number; body: RichDoc } | null>(null)
  useAiPageContext(channelId)

  const channel = header.data?.channel
  useEffect(() => {
    if (channel === undefined) return
    setAnchor((current) =>
      current?.channelId === channelId
        ? current
        : { channelId, lastRead: channel.lastReadMessageId ?? null },
    )
  }, [channel, channelId])

  const allMessages = useMemo(
    () => (messages.data?.pages ?? []).flatMap((page) => page.messages),
    [messages.data],
  )
  const todayLabel = t`Today`
  const yesterdayLabel = t`Yesterday`
  const locale = i18n.locale
  const rows = useMemo(
    () =>
      buildRows(allMessages, anchor?.channelId === channelId ? anchor.lastRead : null, {
        today: todayLabel,
        yesterday: yesterdayLabel,
        locale,
      }),
    [allMessages, anchor, channelId, todayLabel, yesterdayLabel, locale],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const lastSent = useRef<string | null>(null)
  const initialScrolled = useRef(false)
  const preservePrepend = useRef<number | null>(null)

  useEffect(() => {
    initialScrolled.current = false
    lastSent.current = null
    atBottom.current = true
  }, [channelId])

  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 84,
    overscan: 8,
    getItemKey: (index) => {
      const row = rows[index]
      return row === undefined
        ? index
        : row.kind === "message"
          ? row.message.id
          : `${row.kind}-${index}`
    },
  })

  // Initial position: the divider if there is unread history, otherwise the newest message.
  useLayoutEffect(() => {
    if (initialScrolled.current || anchor?.channelId !== channelId || rows.length === 0) return
    initialScrolled.current = true
    const dividerIndex = rows.findIndex((row) => row.kind === "divider")
    if (dividerIndex >= 0 && dividerIndex < rows.length - 1) {
      // Stay at the divider: the follow-to-bottom effect must not override it.
      atBottom.current = false
      virtualizer.scrollToIndex(dividerIndex, { align: "start" })
    } else {
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" })
    }
  }, [anchor, channelId, rows, virtualizer])

  // Keep the viewport still when older pages are prepended; follow new messages at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    // Wait for the initial position (it needs the read anchor) before following anything.
    if (el === null || !initialScrolled.current) return
    if (preservePrepend.current !== null) {
      el.scrollTop += el.scrollHeight - preservePrepend.current
      preservePrepend.current = null
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [allMessages])

  const markRead = () => {
    const el = scrollRef.current
    const newest = allMessages[allMessages.length - 1]
    // Before the initial position is set the list is unmeasured and reads as "at bottom".
    if (el === null || newest === undefined || anchor?.channelId !== channelId) return
    if (!initialScrolled.current) return
    if (lastSent.current === newest.id) return
    if (document.visibilityState !== "visible") return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 80) return
    lastSent.current = newest.id
    void callApi((api) =>
      api.chat.markRead({ params: { channelId }, payload: { messageId: newest.id } }),
    )
      .then(() => queryClient.invalidateQueries({ queryKey: chatKeys.channels }))
      .catch(() => {
        lastSent.current = null
      })
  }

  useEffect(() => {
    markRead()
  })

  useEffect(() => {
    const onVisible = () => markRead()
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  })

  const onScroll = () => {
    const el = scrollRef.current
    if (el === null) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80
    markRead()
    if (el.scrollTop < 120 && messages.hasPreviousPage && !messages.isFetchingPreviousPage) {
      preservePrepend.current = el.scrollHeight
      void messages.fetchPreviousPage()
    }
  }

  const invalidateChannel = () =>
    Promise.all(
      messageChangeKeys(channelId).map((key) => queryClient.invalidateQueries({ queryKey: key })),
    )

  const join = useMutation({
    mutationFn: () => callApi((api) => api.chat.joinChannel({ params: { channelId } })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKeys.channels }),
        queryClient.invalidateQueries({ queryKey: chatKeys.browse }),
        queryClient.invalidateQueries({ queryKey: chatKeys.channel(channelId) }),
      ]),
    onError: (caught) => setError(caught),
  })

  const typing = viewers.filter((viewer) => viewer.typing && viewer.userId !== meId)

  if (header.isPending) return <LoadingRows />
  if (header.isError) return <ErrorMessage error={header.error} />
  const data = header.data
  const isMember = data.channel.isMember

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={channelTitle(data.channel)}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{channelTitle(data.channel)}</h1>
          {data.channel.topic === null || data.channel.topic === "" ? null : (
            <p className="truncate text-sm text-muted-foreground">{data.channel.topic}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ChannelAiMenu
            channelId={channelId}
            onDraft={(text) =>
              setDraft((previous) => ({ key: (previous?.key ?? 0) + 1, body: paragraphDoc(text) }))
            }
          />
          <Button variant="ghost" size="sm" onClick={() => setDialog("pins")}>
            <Pin className="size-4" />
            <Trans>Pinned</Trans>
            {data.pinCount > 0 ? <Badge variant="secondary">{data.pinCount}</Badge> : null}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Channel settings`}
            onClick={() => setDialog("settings")}
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </header>

      {data.adminRead ? (
        <output className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Trans>You are reading this private channel as an administrator. Access is logged.</Trans>
        </output>
      ) : null}

      {isMember || data.channel.kind !== "public" ? null : (
        <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
          <span>
            <Trans>You are viewing this channel without joining it.</Trans>
          </span>
          <Button size="sm" disabled={join.isPending} onClick={() => join.mutate()}>
            <Trans>Join channel</Trans>
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-label={t`Messages`}
      >
        {messages.isPending ? <LoadingRows /> : null}
        {messages.isError ? <ErrorMessage error={messages.error} /> : null}
        {messages.isFetchingPreviousPage ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            <Trans>Loading older messages…</Trans>
          </p>
        ) : null}
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (row === undefined) return null
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.kind === "day" ? (
                  <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {row.label}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : row.kind === "divider" ? (
                  <div className="flex items-center gap-2 px-4 py-1 text-xs font-medium text-link">
                    <span className="h-px flex-1 bg-primary/40" />
                    <Trans>New messages</Trans>
                    <span className="h-px flex-1 bg-primary/40" />
                  </div>
                ) : (
                  <MessageItem
                    message={row.message}
                    channelId={channelId}
                    meId={meId}
                    canPin
                    threadActive={row.message.id === activeThreadId}
                    onOpenThread={(messageId) =>
                      void navigate({
                        to: "/c/$channelId/t/$threadId",
                        params: { channelId, threadId: messageId },
                      })
                    }
                    onCreateTask={(message) => setTaskFrom(message)}
                  />
                )}
              </div>
            )
          })}
        </div>
        {messages.isSuccess && allMessages.length === 0 ? (
          <EmptyState icon={MessagesSquare} title={t`No messages yet. Say hello.`} />
        ) : null}
      </div>

      <div className="shrink-0 space-y-1 border-t p-3">
        <p className="h-4 text-xs text-muted-foreground" aria-live="polite">
          {typing.length === 0 ? null : typingLabel(typing.map((viewer) => viewer.name))}
        </p>
        {isMember ? (
          <Composer
            channelId={channelId}
            key={draft?.key ?? 0}
            initial={draft?.body}
            placeholder={t`Message ${channelTitle(data.channel)}`}
            submitLabel={t`Send`}
            onTyping={(typingNow) => sendTyping(scope, typingNow)}
            onSubmit={async (body: RichDoc) => {
              atBottom.current = true
              await callApi((api) =>
                api.chat.postMessage({ params: { channelId }, payload: { body } }),
              )
              await invalidateChannel()
            }}
          />
        ) : null}
        {error === null ? null : <ErrorMessage error={error} />}
      </div>

      <ChannelSettingsDialog
        open={dialog === "settings"}
        onOpenChange={(open) => setDialog(open ? "settings" : null)}
        channelId={channelId}
        meId={meId}
      />
      <PinsDialog
        open={dialog === "pins"}
        onOpenChange={(open) => setDialog(open ? "pins" : null)}
        channelId={channelId}
        meId={meId}
      />
      <MessageToTaskDialog
        message={taskFrom}
        onOpenChange={(open) => {
          if (!open) setTaskFrom(null)
        }}
      />
    </section>
  )
}
