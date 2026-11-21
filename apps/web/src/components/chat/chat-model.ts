import type { ChannelSummary } from "@audit/domain/chat/schema"
import { channelTitle } from "./channel-title.ts"

/** Where the channel route remembers the last channel, so `/chat` can resume it. */
export const LAST_CHANNEL_KEY = "audit.lastChannel"

export const isRoom = (channel: ChannelSummary): boolean =>
  channel.kind === "public" || channel.kind === "private"

/** Rooms first, then direct messages; each keeps the order the server returned. */
export const orderChannels = (channels: ReadonlyArray<ChannelSummary>): ChannelSummary[] => [
  ...channels.filter(isRoom),
  ...channels.filter((channel) => !isRoom(channel)),
]

/** Unread messages across rooms and direct messages; drives the Chat badge in the shell. */
export const chatUnreadTotal = (channels: ReadonlyArray<ChannelSummary>): number =>
  channels.reduce((sum, channel) => sum + channel.unread, 0)

/** Case-insensitive match on the display title. A blank query keeps everything. */
export const filterChannels = (
  channels: ReadonlyArray<ChannelSummary>,
  query: string,
): ChannelSummary[] => {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === "") return [...channels]
  return channels.filter((channel) => channelTitle(channel).toLocaleLowerCase().includes(needle))
}

/**
 * The channel `/chat` opens on wide screens: the last visited one if it still exists,
 * otherwise the first in sidebar order. `undefined` when there are no channels.
 */
export const chatLandingChannelId = (
  channels: ReadonlyArray<ChannelSummary>,
  lastChannelId: string | null,
): string | undefined => {
  const ordered = orderChannels(channels)
  if (lastChannelId !== null && ordered.some((channel) => channel.id === lastChannelId)) {
    return lastChannelId
  }
  return ordered[0]?.id
}

export const readLastChannel = (): string | null => {
  try {
    return localStorage.getItem(LAST_CHANNEL_KEY)
  } catch {
    return null
  }
}

export const writeLastChannel = (channelId: string): void => {
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, channelId)
  } catch {
    // Storage can be unavailable (private mode); the landing then falls back to the first channel.
  }
}
