import { useEffect } from "react"
import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router"
import type { ChannelId } from "@audit/domain/ids"
import { ChannelView } from "../components/chat/channel-view.tsx"
import { writeLastChannel } from "../components/chat/chat-model.ts"

export const Route = createFileRoute("/_app/_chat/c/$channelId")({
  component: ChannelRoute,
})

function ChannelRoute() {
  const { channelId } = Route.useParams()
  const { me } = Route.useRouteContext()
  const matchRoute = useMatchRoute()
  // On narrow screens an open thread takes the whole column instead of sitting beside the channel.
  const inThread = matchRoute({ to: "/c/$channelId/t/$threadId", fuzzy: true }) !== false

  useEffect(() => {
    writeLastChannel(channelId)
  }, [channelId])

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className={`flex min-w-0 flex-1 flex-col${inThread ? " max-md:hidden" : ""}`}>
        <ChannelView channelId={channelId as ChannelId} meId={me.userId} />
      </div>
      <Outlet />
    </div>
  )
}
