import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useNavigate } from "@tanstack/react-router"
import { Pin, Settings } from "lucide-react"
import type { ChannelSummary, Message } from "@audit/domain/chat/schema"
import type { ChannelId } from "@audit/domain/ids"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { callApi } from "../../lib/api.ts"
import { channelQuery, chatKeys, messageChangeKeys, messagesQuery } from "../../lib/chat.ts"
import { sendTyping, usePresence, useRealtimeScopes } from "../../lib/realtime.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { Composer } from "./composer.tsx"
import { MessageItem } from "./message-item.tsx"
import { ChannelSettingsDialog, MessageToTaskDialog, PinsDialog } from "./dialogs.tsx"
import { typingLabel } from "./typing.ts"

type Row = { readonly kind: "divider" } | { readonly kind: "message"; readonly message: Message }

/** Divider goes before the first message after `lastReadId`; with no read marker, at the top. */
const buildRows = (messages: ReadonlyArray<Message>, lastReadId: string | null): Row[] => {
  const rows: Row[] = messages.map((message) => ({ kind: "message", message }))
  if (messages.length === 0) return rows
  const index = lastReadId === null ? -1 : messages.findIndex((m) => m.id === lastReadId)
  if (lastReadId !== null && index === messages.length - 1) return rows
  rows.splice(index + 1, 0, { kind: "divider" })
  return rows
}

export const channelTitle = (channel: ChannelSummary): string =>
  channel.kind === "dm" || channel.kind === "group_dm"
    ? channel.people.map((person) => person.name).join(", ")
    : `#${channel.name}`

interface ChannelViewProps {
  readonly channelId: ChannelId
  readonly meId: string
}

/** A channel: header, timeline, typing indicator and composer. */
export function ChannelView({ channelId, meId }: ChannelViewProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const scope = `channel:${channelId}`
  useRealtimeScopes([scope])

  const header = useQuery(channelQuery(channelId))
  const messages = useInfiniteQuery(messagesQuery(channelId))
  const viewers = usePresence(scope)
  const [dialog, setDialog] = useState<"settings" | "pins" | null>(null)
  const [taskFrom, setTaskFrom] = useState<Message | null>(null)
  const [anchor, setAnchor] = useState<{ channelId: string; lastRead: string | null } | null>(null)
  const [error, setError] = useState<unknown>(null)

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
  const rows = useMemo(
    () => buildRows(allMessages, anchor?.channelId === channelId ? anchor.lastRead : null),
    [allMessages, anchor, channelId],
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
      return row === undefined ? index : row.kind === "divider" ? "divider" : row.message.id
    },
  })

  // Initial position: the divider if there is unread history, otherwise the newest message.
  useLayoutEffect(() => {
    if (initialScrolled.current || anchor?.channelId !== channelId || rows.length === 0) return
    initialScrolled.current = true
    const dividerIndex = rows.findIndex((row) => row.kind === "divider")
    if (dividerIndex >= 0 && dividerIndex < rows.length - 1) {
      virtualizer.scrollToIndex(dividerIndex, { align: "start" })
    } else {
      virtualizer.scrollToIndex(rows.length - 1, { align: "end" })
    }
  }, [anchor, channelId, rows, virtualizer])

  // Keep the viewport still when older pages are prepended; follow new messages at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el === null) return
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
    if (el === null || newest === undefined || anchor?.channelId !== channelId) return
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
  const candidates = (header.data?.members ?? []).map((member) => ({
    id: member.userId,
    label: member.name,
  }))

  if (header.isPending) return <LoadingRows />
  if (header.isError) return <ErrorMessage error={header.error} />
  const data = header.data
  const isMember = data.channel.isMember

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={channelTitle(data.channel)}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{channelTitle(data.channel)}</h1>
          {data.channel.topic === null || data.channel.topic === "" ? null : (
            <p className="truncate text-sm text-muted-foreground">{data.channel.topic}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDialog("pins")}>
            <Pin className="size-4" />
            <Trans>Pinned</Trans>
            <Badge variant="secondary">{data.pinCount}</Badge>
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
        <output className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
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
                {row.kind === "divider" ? (
                  <div className="flex items-center gap-2 px-4 py-1 text-xs font-medium text-primary">
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
                    candidates={candidates}
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
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            <Trans>No messages yet. Say hello.</Trans>
          </p>
        ) : null}
      </div>

      <div className="space-y-1 border-t p-3">
        <p className="h-4 text-xs text-muted-foreground" aria-live="polite">
          {typing.length === 0 ? null : typingLabel(typing.map((viewer) => viewer.name))}
        </p>
        {isMember ? (
          <Composer
            channelId={channelId}
            candidates={candidates}
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
        candidates={candidates}
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
