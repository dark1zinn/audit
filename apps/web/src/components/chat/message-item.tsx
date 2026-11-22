import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, MessageSquare } from "lucide-react"
import type { Message } from "@audit/domain/chat/schema"
import type { ChannelId, MessageId } from "@audit/domain/ids"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { EntityActionsButton, EntityContextMenu } from "../actions/entity-menu.tsx"
import type { EntityTarget } from "../actions/types.ts"
import { callApi } from "../../lib/api.ts"
import { messageChangeKeys } from "../../lib/chat.ts"
import { ErrorMessage } from "../feedback.tsx"
import { Composer } from "./composer.tsx"
import { MessageBody } from "./message-body.tsx"
import { formatMessageTime } from "./format-time.ts"

export const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👀", "😂", "🙏"] as const

interface MessageItemProps {
  readonly message: Message
  readonly channelId: ChannelId
  readonly meId: string
  readonly canPin: boolean
  readonly onOpenThread?: (messageId: MessageId) => void
  readonly threadActive?: boolean
  readonly onCreateTask?: (message: Message) => void
}

/** One chat message: body, reactions and actions. Own messages can be edited and deleted. */
export function MessageItem({
  message,
  channelId,
  meId,
  canPin,
  onOpenThread,
  threadActive = false,
  onCreateTask,
}: MessageItemProps) {
  const { t, i18n } = useLingui()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const isMine = message.author.id === meId
  const invalidate = () =>
    Promise.all(
      messageChangeKeys(channelId).map((key) => queryClient.invalidateQueries({ queryKey: key })),
    )

  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      setError(null)
      return invalidate()
    },
    onError: (caught) => setError(caught),
  })

  if (message.deletedAt !== null) {
    return (
      <div className="px-4 py-2 text-sm italic text-muted-foreground">
        <Trans>This message was deleted.</Trans>
      </div>
    )
  }

  const reactionToggle = (emoji: string, mine: boolean) =>
    run.mutate(() =>
      mine
        ? callApi((api) =>
            api.chat.removeReaction({ params: { messageId: message.id }, payload: { emoji } }),
          )
        : callApi((api) =>
            api.chat.addReaction({ params: { messageId: message.id }, payload: { emoji } }),
          ),
    )

  const actionTarget: EntityTarget = {
    kind: "message",
    message,
    channelId,
    canPin,
    onReply: onOpenThread === undefined ? undefined : () => onOpenThread(message.id),
    onCreateTask: onCreateTask === undefined ? undefined : () => onCreateTask(message),
    onEdit: isMine ? () => setEditing(true) : undefined,
  }
  const article = (
    <article
      className={`group relative px-4 py-2 ${threadActive ? "bg-accent" : "hover:bg-muted/40"}`}
      aria-label={t`Message`}
    >
      <header className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold">{message.author.name}</span>
        <time
          className="text-xs text-muted-foreground"
          dateTime={String(message.createdAt)}
          title={formatMessageTime(message.createdAt, i18n.locale, "full")}
        >
          {formatMessageTime(message.createdAt, i18n.locale, "short")}
        </time>
        {message.editedAt === null ? null : (
          <span className="text-xs text-muted-foreground">
            <Trans>(edited)</Trans>
          </span>
        )}
        {message.pinned ? (
          <Badge variant="secondary">
            <Trans>Pinned</Trans>
          </Badge>
        ) : null}
        <div className="-my-1 ms-auto flex items-center gap-0.5 rounded-md border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
          {onOpenThread === undefined ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onOpenThread(message.id)}
            >
              <MessageSquare className="size-3.5" />
              <Trans>Reply</Trans>
            </Button>
          )}
          <EntityActionsButton target={actionTarget} label={t`Message actions`} />
        </div>
      </header>

      {editing ? (
        <div className="mt-1">
          <Composer
            channelId={channelId}
            placeholder={t`Edit message`}
            submitLabel={t`Save`}
            submitIcon={Check}
            initial={message.body as RichDoc}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              await callApi((api) =>
                api.chat.editMessage({
                  params: { messageId: message.id },
                  payload: { body, version: message.version },
                }),
              )
              setEditing(false)
              await invalidate()
            }}
          />
        </div>
      ) : (
        <div className="mt-1">
          <MessageBody body={message.body} />
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {message.reactions.map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            aria-pressed={reaction.mine}
            onClick={() => reactionToggle(reaction.emoji, reaction.mine)}
            className={`rounded-full border px-2 py-0.5 text-xs ${reaction.mine ? "border-primary bg-primary/10" : ""}`}
          >
            {reaction.emoji} {reaction.count}
          </button>
        ))}
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={t`React with ${emoji}`}
            className="hidden rounded px-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-block group-focus-within:inline-block"
            onClick={() => reactionToggle(emoji, false)}
          >
            {emoji}
          </button>
        ))}
        {onOpenThread === undefined || message.replyCount === 0 ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onOpenThread(message.id)}
          >
            <MessageSquare className="size-3.5" />
            <Trans>{message.replyCount} replies</Trans>
          </Button>
        )}
      </div>

      {error === null ? null : <ErrorMessage error={error} />}
    </article>
  )
  if (editing) return article
  return <EntityContextMenu target={actionTarget}>{article}</EntityContextMenu>
}
