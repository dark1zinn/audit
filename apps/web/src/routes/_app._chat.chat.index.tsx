import { useEffect, useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { MessagesSquare } from "lucide-react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@audit/ui/components/ui/empty.tsx"
import { CreateChannelDialog } from "../components/chat/dialogs.tsx"
import { chatLandingChannelId, readLastChannel } from "../components/chat/chat-model.ts"
import { useWideScreen } from "../components/chat/use-wide-screen.ts"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { channelsQuery } from "../lib/chat.ts"

export const Route = createFileRoute("/_app/_chat/chat/")({
  component: ChatIndex,
})

/**
 * `/chat` on wide screens opens the last visited channel, or the first one.
 * On narrow screens the layout shows the channel list instead, so this renders nothing.
 */
function ChatIndex() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const wide = useWideScreen()
  const channels = useQuery(channelsQuery)
  const [creating, setCreating] = useState(false)

  const target =
    channels.data === undefined ? undefined : chatLandingChannelId(channels.data, readLastChannel())

  useEffect(() => {
    if (!wide || target === undefined) return
    void navigate({ to: "/c/$channelId", params: { channelId: target }, replace: true })
  }, [wide, target, navigate])

  if (!wide) return null
  if (channels.isPending) return <LoadingRows />
  if (channels.isError) return <ErrorMessage error={channels.error} />
  if (target !== undefined) return <LoadingRows />

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia>
          <MessagesSquare className="size-8" aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          <Trans>No channels yet</Trans>
        </EmptyTitle>
        <EmptyDescription>
          <Trans>Create a channel to start a conversation with your team.</Trans>
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => setCreating(true)}>{t`Create channel`}</Button>
      </EmptyContent>
      <CreateChannelDialog open={creating} onOpenChange={setCreating} />
    </Empty>
  )
}
