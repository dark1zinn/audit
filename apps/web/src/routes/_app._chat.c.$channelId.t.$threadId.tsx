import { createFileRoute } from "@tanstack/react-router"
import type { ChannelId, MessageId } from "@audit/domain/ids"
import { ThreadPanel } from "../components/chat/thread-panel.tsx"

export const Route = createFileRoute("/_app/c/$channelId/t/$threadId")({
  component: ThreadRoute,
})

function ThreadRoute() {
  const { channelId, threadId } = Route.useParams()
  const { me } = Route.useRouteContext()
  return (
    <ThreadPanel
      channelId={channelId as ChannelId}
      rootId={threadId as MessageId}
      meId={me.userId}
    />
  )
}
