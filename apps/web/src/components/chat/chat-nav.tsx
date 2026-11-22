import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Bookmark, Compass, MessageSquare, Plus } from "lucide-react"
import type { ChannelSummary } from "@audit/domain/chat/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { EntityContextMenu } from "../actions/entity-menu.tsx"
import { channelsQuery } from "../../lib/chat.ts"
import { useRealtimeScopes } from "../../lib/realtime.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { BrowseChannelsDialog, CreateChannelDialog, NewDmDialog } from "./dialogs.tsx"
import { channelTitle } from "./channel-title.ts"
import { chatUnreadTotal, filterChannels, isRoom } from "./chat-model.ts"

const rowClass =
  "flex min-h-9 items-center justify-between gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"

const groupLabelClass = "text-xs font-medium uppercase text-muted-foreground"

/** Subscribes to every channel's realtime scope and sums the unread counts. */
export function useChatUnreadTotal(): number {
  const channels = useQuery(channelsQuery)
  const all = channels.data ?? []
  useRealtimeScopes(all.map((channel) => `channel:${channel.id}`))
  return chatUnreadTotal(all)
}

function ChannelRow({ channel }: { readonly channel: ChannelSummary }) {
  const title = channelTitle(channel)
  const unread = channel.unread > 0 || channel.mentions > 0
  return (
    <EntityContextMenu target={{ kind: "channel", channel }}>
      <Link
        to="/c/$channelId"
        params={{ channelId: channel.id }}
        className={unread ? `${rowClass} font-semibold text-foreground` : rowClass}
        activeProps={{ className: "bg-accent text-accent-foreground" }}
      >
        <span className="min-w-0 truncate" title={title}>
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {channel.mentions > 0 ? <Badge variant="destructive">@{channel.mentions}</Badge> : null}
          {channel.unread > 0 && channel.mentions === 0 ? (
            <Badge variant="secondary">{channel.unread}</Badge>
          ) : null}
        </span>
      </Link>
    </EntityContextMenu>
  )
}

/** Left column of the Chat view: filter, threads and saved, channels, direct messages. */
export function ChatNav({ meId }: { readonly meId: string }) {
  const { t } = useLingui()
  const channels = useQuery(channelsQuery)
  const [filter, setFilter] = useState("")
  const [creating, setCreating] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [messaging, setMessaging] = useState(false)

  const all = channels.data ?? []
  useRealtimeScopes(all.map((channel) => `channel:${channel.id}`))
  const visible = filterChannels(all, filter)
  const rooms = visible.filter(isRoom)
  const direct = visible.filter((channel) => !isRoom(channel))

  return (
    <nav aria-label={t`Chat`} className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <Input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t`Filter conversations`}
        aria-label={t`Filter conversations`}
        className="h-8"
      />

      <div className="flex flex-col gap-1">
        <Link
          to="/threads"
          className={rowClass}
          activeProps={{ className: `${rowClass} bg-accent text-accent-foreground` }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <MessageSquare className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              <Trans>Threads</Trans>
            </span>
          </span>
        </Link>
        <Link
          to="/saved"
          className={rowClass}
          activeProps={{ className: `${rowClass} bg-accent text-accent-foreground` }}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Bookmark className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              <Trans>Saved</Trans>
            </span>
          </span>
        </Link>
      </div>

      <section className="flex flex-col gap-1" aria-labelledby="chat-channels-heading">
        <div className="flex items-center justify-between ps-2">
          <h2 id="chat-channels-heading" className={groupLabelClass}>
            <Trans>Channels</Trans>
          </h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t`Browse channels`}
              onClick={() => setBrowsing(true)}
            >
              <Compass className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t`New channel`}
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        {channels.isPending ? <LoadingRows /> : null}
        {channels.isError ? <ErrorMessage error={channels.error} /> : null}
        {rooms.map((channel) => (
          <ChannelRow key={channel.id} channel={channel} />
        ))}
      </section>

      <section className="flex flex-col gap-1" aria-labelledby="chat-dm-heading">
        <div className="flex items-center justify-between ps-2">
          <h2 id="chat-dm-heading" className={groupLabelClass}>
            <Trans>Direct messages</Trans>
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t`New direct message`}
            onClick={() => setMessaging(true)}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
        {direct.map((channel) => (
          <ChannelRow key={channel.id} channel={channel} />
        ))}
      </section>

      <CreateChannelDialog open={creating} onOpenChange={setCreating} />
      <BrowseChannelsDialog open={browsing} onOpenChange={setBrowsing} />
      <NewDmDialog open={messaging} onOpenChange={setMessaging} meId={meId} />
    </nav>
  )
}
