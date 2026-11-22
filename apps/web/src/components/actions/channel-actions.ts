import { useLingui } from "@lingui/react/macro"
import { useQueryClient } from "@tanstack/react-query"
import { BellOff, Copy, LogOut, Archive, Settings, Check } from "lucide-react"
import { toast } from "sonner"
import type { ChannelId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"
import { channelHref } from "../../lib/entity-links.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { absoluteHref, useCopyText, useGo, useRunAction } from "./shared.ts"

type ChannelTarget = Extract<EntityTarget, { kind: "channel" }>

export const useChannelActions = (target: ChannelTarget | null): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const go = useGo()
  const copy = useCopyText()
  const queryClient = useQueryClient()
  const run = useRunAction(() => queryClient.invalidateQueries({ queryKey: ["chat"] }))
  if (target === null) return []
  const channel = target.channel
  const channelId = channel.id as ChannelId
  const href = channelHref(channel.id)

  const setLevel = (level: "all" | "mentions" | "none") =>
    run.mutate(() =>
      callApi((api) =>
        api.chat.setNotify({ params: { channelId }, payload: { level, mutedUntil: null } }),
      ),
    )

  const archived = channel.archivedAt !== null

  return [
    [
      { id: "open", label: t`Open`, run: () => go(href) },
      {
        id: "mark-read",
        label: t`Mark as read`,
        icon: Check,
        run: () =>
          run.mutate(async () => {
            const page = await callApi((api) =>
              api.chat.messages({ params: { channelId }, query: { limit: 1 } }),
            )
            const newest = page.messages[page.messages.length - 1]
            if (newest === undefined) return
            await callApi((api) =>
              api.chat.markRead({ params: { channelId }, payload: { messageId: newest.id } }),
            )
          }),
      },
      {
        id: "notifications",
        label: t`Notifications`,
        icon: BellOff,
        children: [
          { id: "notify-all", label: t`All messages`, run: () => setLevel("all") },
          { id: "notify-mentions", label: t`Mentions only`, run: () => setLevel("mentions") },
          { id: "notify-none", label: t`Nothing`, run: () => setLevel("none") },
        ],
      },
      { id: "settings", label: t`Settings`, icon: Settings, run: target.onSettings },
    ],
    [
      {
        id: "copy-link",
        label: t`Copy link`,
        icon: Copy,
        run: () => copy(absoluteHref(href), t`Link copied`),
      },
    ],
    [
      {
        id: "leave",
        label: t`Leave`,
        icon: LogOut,
        variant: "destructive",
        confirm: {
          title: t`Leave “${channel.name}”?`,
          description: t`You will stop receiving messages from this channel.`,
          confirmLabel: t`Leave`,
        },
        run: () =>
          run.mutate(() => callApi((api) => api.chat.leaveChannel({ params: { channelId } })), {
            onSuccess: () => toast.success(t`Left channel`),
          }),
      },
      {
        id: "archive",
        label: archived ? t`Unarchive` : t`Archive`,
        icon: Archive,
        variant: archived ? "default" : "destructive",
        confirm: archived
          ? undefined
          : {
              title: t`Archive “${channel.name}”?`,
              description: t`The channel becomes read-only for everyone.`,
              confirmLabel: t`Archive`,
            },
        run: () =>
          run.mutate(
            () =>
              archived
                ? callApi((api) => api.chat.unarchiveChannel({ params: { channelId } }))
                : callApi((api) => api.chat.archiveChannel({ params: { channelId } })),
            {
              onSuccess: () =>
                toast.success(archived ? t`Channel unarchived` : t`Channel archived`),
            },
          ),
      },
    ],
  ]
}
