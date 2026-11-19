import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query"
import type { ChannelId, MessageId } from "@audit/domain/ids"
import type { MessagePageQuery } from "@audit/domain/chat/schema"
import { callApi } from "./api.ts"

/** Messages are fetched in pages of this size, newest page first. */
export const MESSAGE_PAGE = 50

/**
 * Chat query keys. Realtime events invalidate them by prefix (see `realtime.ts`): every channel
 * key starts with `["chat", "channel", channelId]`, so one prefix covers its header, pages and pins.
 */
export const chatKeys = {
  channels: ["chat", "channels"] as const,
  browse: ["chat", "browse"] as const,
  channel: (channelId: ChannelId) => ["chat", "channel", channelId] as const,
  messages: (channelId: ChannelId) => ["chat", "channel", channelId, "messages"] as const,
  pins: (channelId: ChannelId) => ["chat", "channel", channelId, "pins"] as const,
  threads: ["chat", "threads"] as const,
  thread: (messageId: MessageId) => ["chat", "thread", messageId] as const,
  saved: ["chat", "saved"] as const,
  adminChannel: (channelId: ChannelId) => ["chat", "admin", channelId] as const,
  adminMessages: (channelId: ChannelId) => ["chat", "admin", channelId, "messages"] as const,
}

export const channelsQuery = queryOptions({
  queryKey: chatKeys.channels,
  queryFn: () => callApi((api) => api.chat.channels()),
})

export const browseQuery = queryOptions({
  queryKey: chatKeys.browse,
  queryFn: () => callApi((api) => api.chat.browse()),
})

export const channelQuery = (channelId: ChannelId) =>
  queryOptions({
    queryKey: chatKeys.channel(channelId),
    queryFn: () => callApi((api) => api.chat.channel({ params: { channelId } })),
  })

export const adminChannelQuery = (channelId: ChannelId) =>
  queryOptions({
    queryKey: chatKeys.adminChannel(channelId),
    queryFn: () => callApi((api) => api.chat.adminChannel({ params: { channelId } })),
  })

export const pinsQuery = (channelId: ChannelId) =>
  queryOptions({
    queryKey: chatKeys.pins(channelId),
    queryFn: () => callApi((api) => api.chat.pins({ params: { channelId } })),
  })

/**
 * The channel timeline. Pages are kept oldest first: the first page is the newest 50 messages and
 * older pages are prepended with `fetchPreviousPage`.
 */
export const messagesQuery = (channelId: ChannelId) =>
  infiniteQueryOptions({
    queryKey: chatKeys.messages(channelId),
    queryFn: ({ pageParam }) =>
      callApi((api) => api.chat.messages({ params: { channelId }, query: pageParam })),
    initialPageParam: { limit: MESSAGE_PAGE } as MessagePageQuery,
    getPreviousPageParam: (first) => {
      const oldest = first.messages[0]
      return first.hasOlder && oldest !== undefined
        ? { before: oldest.id, limit: MESSAGE_PAGE }
        : undefined
    },
    getNextPageParam: () => undefined,
  })

export const adminMessagesQuery = (channelId: ChannelId) =>
  queryOptions({
    queryKey: chatKeys.adminMessages(channelId),
    queryFn: () =>
      callApi((api) =>
        api.chat.adminMessages({ params: { channelId }, query: { limit: MESSAGE_PAGE } }),
      ),
  })

export const threadQuery = (messageId: MessageId) =>
  queryOptions({
    queryKey: chatKeys.thread(messageId),
    queryFn: () =>
      callApi((api) => api.chat.thread({ params: { messageId }, query: { limit: MESSAGE_PAGE } })),
  })

export const threadsQuery = queryOptions({
  queryKey: chatKeys.threads,
  queryFn: () => callApi((api) => api.chat.threads()),
})

export const savedQuery = queryOptions({
  queryKey: chatKeys.saved,
  queryFn: () => callApi((api) => api.chat.saved()),
})

/** Channel-level keys touched by any message change in `channelId`. */
export const messageChangeKeys = (channelId: ChannelId) => [
  chatKeys.channels,
  chatKeys.channel(channelId),
  chatKeys.threads,
  ["chat", "thread"],
  chatKeys.saved,
  chatKeys.adminChannel(channelId),
]

/** Cursor for the newest message in a flattened timeline, used for monotonic mark-read. */
export const newestId = (ids: ReadonlyArray<string>): string | undefined => {
  let newest: string | undefined
  for (const id of ids) if (newest === undefined || id > newest) newest = id
  return newest
}
