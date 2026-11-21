import { createFileRoute, Outlet } from "@tanstack/react-router"
import type { ChannelId } from "@audit/domain/ids"
import { ChannelView } from "../components/chat/channel-view.tsx"

export const Route = createFileRoute("/_app/c/$channelId")({
  component: ChannelRoute,
})

function ChannelRoute() {
  const { channelId } = Route.useParams()
  const { me } = Route.useRouteContext()
  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[420px] overflow-hidden rounded-md border">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChannelView channelId={channelId as ChannelId} meId={me.userId} />
      </div>
      <Outlet />
    </div>
  )
}
