import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ChannelSummary } from "@audit/domain/chat/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { channelsQuery } from "../../lib/chat.ts"
import { useRealtimeScopes } from "../../lib/realtime.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { BrowseChannelsDialog, CreateChannelDialog, NewDmDialog } from "./dialogs.tsx"
import { channelTitle } from "./channel-title.ts"

const linkClass =
  "flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"

function ChannelLink({ channel }: { readonly channel: ChannelSummary }) {
  return (
    <Link
      to="/c/$channelId"
      params={{ channelId: channel.id }}
      className={linkClass}
      activeProps={{ className: "bg-accent text-accent-foreground font-medium" }}
    >
      <span className="min-w-0 truncate">{channelTitle(channel)}</span>
      <span className="flex shrink-0 items-center gap-1">
        {channel.mentions > 0 ? <Badge variant="destructive">@{channel.mentions}</Badge> : null}
        {channel.unread > 0 && channel.mentions === 0 ? (
          <Badge variant="secondary">{channel.unread}</Badge>
        ) : null}
      </span>
    </Link>
  )
}

/** Chat section of the sidebar: channels, DMs, threads and saved messages. */
export function ChatNav({ meId }: { readonly meId: string }) {
  const { t } = useLingui()
  const channels = useQuery(channelsQuery)
  const [creating, setCreating] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [messaging, setMessaging] = useState(false)

  const all = channels.data ?? []
  useRealtimeScopes(all.map((channel) => `channel:${channel.id}`))
  const rooms = all.filter((channel) => channel.kind === "public" || channel.kind === "private")
  const direct = all.filter((channel) => channel.kind === "dm" || channel.kind === "group_dm")

  return (
    <nav aria-label={t`Chat`} className="mt-4 flex min-h-0 flex-col gap-1 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          <Trans>Channels</Trans>
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setBrowsing(true)}>
            <Trans>Browse</Trans>
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setCreating(true)}>
            <Trans>New</Trans>
          </Button>
        </div>
      </div>
      {channels.isPending ? <LoadingRows /> : null}
      {channels.isError ? <ErrorMessage error={channels.error} /> : null}
      {rooms.map((channel) => (
        <ChannelLink key={channel.id} channel={channel} />
      ))}

      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          <Trans>Direct messages</Trans>
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setMessaging(true)}>
          <Trans>New</Trans>
        </Button>
      </div>
      {direct.map((channel) => (
        <ChannelLink key={channel.id} channel={channel} />
      ))}

      <div className="mt-3 flex flex-col gap-1 border-t pt-3">
        <Link
          to="/threads"
          className={linkClass}
          activeProps={{ className: linkClass + " bg-accent" }}
        >
          <Trans>Threads</Trans>
        </Link>
        <Link
          to="/saved"
          className={linkClass}
          activeProps={{ className: linkClass + " bg-accent" }}
        >
          <Trans>Saved</Trans>
        </Link>
      </div>

      <CreateChannelDialog open={creating} onOpenChange={setCreating} />
      <BrowseChannelsDialog open={browsing} onOpenChange={setBrowsing} />
      <NewDmDialog open={messaging} onOpenChange={setMessaging} meId={meId} />
    </nav>
  )
}
