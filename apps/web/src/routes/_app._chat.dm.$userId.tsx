import { useEffect, useState } from "react"
import { Trans } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { UserId } from "@audit/domain/ids"
import { callApi } from "../lib/api.ts"
import { chatKeys } from "../lib/chat.ts"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"

export const Route = createFileRoute("/_app/_chat/dm/$userId")({
  component: DmRoute,
})

/** Opens (or reuses) the direct message with a person, then replaces the URL with the channel. */
function DmRoute() {
  const { userId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let active = true
    callApi((api) => api.chat.openDm({ payload: { userIds: [userId as UserId] } }))
      .then(async (channel) => {
        await queryClient.invalidateQueries({ queryKey: chatKeys.channels })
        if (active) {
          void navigate({ to: "/c/$channelId", params: { channelId: channel.id }, replace: true })
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught)
      })
    return () => {
      active = false
    }
  }, [userId, navigate, queryClient])

  if (error !== null) return <ErrorMessage error={error} />
  return (
    <div className="space-y-2">
      <LoadingRows />
      <p className="text-sm text-muted-foreground">
        <Trans>Opening conversation…</Trans>
      </p>
    </div>
  )
}
