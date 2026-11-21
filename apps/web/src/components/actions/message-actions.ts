import { useLingui } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Bookmark,
  BookmarkX,
  CornerDownRight,
  Copy,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  ListPlus,
} from "lucide-react"
import type { MessageId } from "@audit/domain/ids"
import { callApi } from "../../lib/api.ts"
import { messageHref } from "../../lib/entity-links.ts"
import { sessionQuery } from "../../lib/queries.ts"
import type { ActionGroup, EntityTarget } from "./types.ts"
import { absoluteHref, useCopyText, useRunAction } from "./shared.ts"

type MessageTarget = Extract<EntityTarget, { kind: "message" }>

export const useMessageActions = (target: MessageTarget | null): ReadonlyArray<ActionGroup> => {
  const { t } = useLingui()
  const copy = useCopyText()
  const queryClient = useQueryClient()
  const me = useQuery(sessionQuery)
  const run = useRunAction(() => queryClient.invalidateQueries({ queryKey: ["chat"] }))
  if (target === null) return []
  const { message, channelId } = target
  const messageId = message.id as MessageId
  const href = messageHref(channelId, message.id)
  const own = me.data?.userId === message.author.id
  const deleted = message.deletedAt !== null

  const toggle = (on: boolean, enable: () => Promise<unknown>, disable: () => Promise<unknown>) =>
    run.mutate(() => (on ? disable() : enable()))

  return [
    [
      ...(target.onReply
        ? [
            {
              id: "reply",
              label: t`Reply in thread`,
              icon: CornerDownRight,
              disabled: deleted,
              run: target.onReply,
            },
          ]
        : []),
      {
        id: "save",
        label: message.saved ? t`Unsave` : t`Save`,
        icon: message.saved ? BookmarkX : Bookmark,
        disabled: deleted,
        run: () =>
          toggle(
            message.saved,
            () => callApi((api) => api.chat.save({ params: { messageId } })),
            () => callApi((api) => api.chat.unsave({ params: { messageId } })),
          ),
      },
      ...(target.canPin
        ? [
            {
              id: "pin",
              label: message.pinned ? t`Unpin` : t`Pin`,
              icon: message.pinned ? PinOff : Pin,
              disabled: deleted,
              run: () =>
                toggle(
                  message.pinned,
                  () => callApi((api) => api.chat.pin({ params: { messageId } })),
                  () => callApi((api) => api.chat.unpin({ params: { messageId } })),
                ),
            },
          ]
        : []),
      ...(target.onCreateTask
        ? [
            {
              id: "create-task",
              label: t`Create task`,
              icon: ListPlus,
              disabled: deleted,
              run: target.onCreateTask,
            },
          ]
        : []),
    ],
    [
      {
        id: "copy-text",
        label: t`Copy text`,
        icon: Copy,
        disabled: deleted,
        run: () => copy(message.bodyText, t`Text copied`),
      },
      {
        id: "copy-link",
        label: t`Copy link`,
        icon: Link2,
        run: () => copy(absoluteHref(href), t`Link copied`),
      },
    ],
    ...(own && !deleted
      ? [
          [
            { id: "edit", label: t`Edit`, icon: Pencil, run: target.onEdit },
            {
              id: "delete",
              label: t`Delete`,
              icon: Trash2,
              variant: "destructive" as const,
              confirm: {
                title: t`Delete this message?`,
                description: t`The message is removed for everyone.`,
                confirmLabel: t`Delete`,
              },
              run: () =>
                run.mutate(() =>
                  callApi((api) => api.chat.deleteMessage({ params: { messageId } })),
                ),
            },
          ],
        ]
      : []),
  ]
}
