import type { ChannelSummary } from "@audit/domain/chat/schema"

/** Display title; lives apart from `channel-view.tsx` so the app shell does not load the composer. */
export const channelTitle = (channel: ChannelSummary): string =>
  channel.kind === "dm" || channel.kind === "group_dm"
    ? channel.people.map((person) => person.name).join(", ")
    : `#${channel.name}`
