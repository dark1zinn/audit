import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Bookmark,
  ListTodo,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react"
import type { Message } from "@audit/domain/chat/schema"
import type { ChannelId, MessageId } from "@audit/domain/ids"
import type { RichDoc } from "@audit/domain/tasks/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import { callApi } from "../../lib/api.ts"
import { messageChangeKeys } from "../../lib/chat.ts"
import { ErrorMessage } from "../feedback.tsx"
import { Composer } from "./composer.tsx"
import { MessageBody } from "./message-body.tsx"

export const REACTION_EMOJIS = ["👍", "❤️", "🎉", "👀", "😂", "🙏"] as const

interface MessageItemProps {
  readonly message: Message
  readonly channelId: ChannelId
  readonly meId: string
  readonly canPin: boolean
  readonly onOpenThread?: (messageId: MessageId) => void
  readonly onCreateTask?: (message: Message) => void
}

/** One chat message: body, reactions and actions. Own messages can be edited and deleted. */
export function MessageItem({
  message,
  channelId,
  meId,
  canPin,
  onOpenThread,
  onCreateTask,
}: MessageItemProps) {
  const { t } = useLingui()
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

  return (
    <article className="group relative px-4 py-2 hover:bg-muted/40" aria-label={t`Message`}>
      <header className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold">{message.author.name}</span>
        <time className="text-xs text-muted-foreground" dateTime={String(message.createdAt)}>
          {new Date(message.createdAt).toLocaleString()}
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
      </header>

      {editing ? (
        <div className="mt-1">
          <Composer
            channelId={channelId}
            placeholder={t`Edit message`}
            submitLabel={t`Save`}
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
            className="hidden rounded px-1 text-sm hover:bg-accent group-hover:inline-block focus:inline-block"
            onClick={() => reactionToggle(emoji, false)}
          >
            {emoji}
          </button>
        ))}
        {onOpenThread === undefined ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onOpenThread(message.id)}
          >
            <MessageSquare className="size-3.5" />
            {message.replyCount > 0 ? (
              <Trans>{message.replyCount} replies</Trans>
            ) : (
              <Trans>Reply</Trans>
            )}
          </Button>
        )}
      </div>

      <div className="absolute right-2 top-1 hidden group-hover:block group-focus-within:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t`Message actions`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                run.mutate(() =>
                  callApi((api) =>
                    message.saved
                      ? api.chat.unsave({ params: { messageId: message.id } })
                      : api.chat.save({ params: { messageId: message.id } }),
                  ),
                )
              }
            >
              <Bookmark className="size-4" />
              {message.saved ? <Trans>Remove from saved</Trans> : <Trans>Save</Trans>}
            </DropdownMenuItem>
            {canPin ? (
              <DropdownMenuItem
                onClick={() =>
                  run.mutate(() =>
                    message.pinned
                      ? callApi((api) => api.chat.unpin({ params: { messageId: message.id } }))
                      : callApi((api) => api.chat.pin({ params: { messageId: message.id } })),
                  )
                }
              >
                <Pin className="size-4" />
                {message.pinned ? <Trans>Unpin</Trans> : <Trans>Pin</Trans>}
              </DropdownMenuItem>
            ) : null}
            {onCreateTask === undefined ? null : (
              <DropdownMenuItem onClick={() => onCreateTask(message)}>
                <ListTodo className="size-4" />
                <Trans>Create task</Trans>
              </DropdownMenuItem>
            )}
            {isMine ? (
              <>
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil className="size-4" />
                  <Trans>Edit</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    run.mutate(() =>
                      callApi((api) =>
                        api.chat.deleteMessage({ params: { messageId: message.id } }),
                      ),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error === null ? null : <ErrorMessage error={error} />}
    </article>
  )
}
