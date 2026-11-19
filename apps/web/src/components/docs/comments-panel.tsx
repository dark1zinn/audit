import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { DocComment } from "@audit/domain/docs/schema"
import type { CommentId, DocId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Textarea } from "@audit/ui/components/ui/textarea.tsx"
import { callApi } from "../../lib/api.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { commentsQuery } from "./queries.ts"

/** A selection the user wants to comment on, encoded as Yjs anchors plus the quoted text. */
export interface PendingAnchor {
  readonly from: string
  readonly to: string
  readonly quote: string
}

interface CommentsPanelProps {
  readonly docId: DocId
  readonly comments: ReadonlyArray<DocComment>
  readonly loading: boolean
  readonly canComment: boolean
  readonly canManage: boolean
  readonly currentUserId: string
  readonly pending: PendingAnchor | null
  readonly onPendingDone: () => void
}

/** Plain text as the minimal Tiptap doc the comment body is stored in. */
const richFromText = (text: string): DocComment["body"] => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

/** Anchored comment threads with replies, resolve/reopen and delete. */
export const CommentsPanel = ({
  docId,
  comments,
  loading,
  canComment,
  canManage,
  currentUserId,
  pending,
  onPendingDone,
}: CommentsPanelProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")
  const [replyTo, setReplyTo] = useState<CommentId | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [error, setError] = useState<unknown>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: commentsQuery(docId).queryKey })

  const create = useMutation({
    mutationFn: (input: { readonly text: string; readonly parent: CommentId | null }) =>
      callApi((api) =>
        api.docs.createComment({
          params: { docId },
          payload: {
            body: richFromText(input.text),
            anchor:
              input.parent === null && pending !== null
                ? { from: pending.from, to: pending.to, quote: pending.quote }
                : null,
            parentCommentId: input.parent,
          },
        }),
      ),
    onSuccess: (_comment, input) => {
      setError(null)
      if (input.parent === null) {
        setDraft("")
        onPendingDone()
      } else {
        setReplyDraft("")
        setReplyTo(null)
      }
      void refresh()
    },
    onError: setError,
  })

  const update = useMutation({
    mutationFn: (comment: DocComment) =>
      callApi((api) =>
        api.docs.updateComment({
          params: { commentId: comment.id },
          payload: { resolved: comment.resolvedAt === null, version: comment.version },
        }),
      ),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError: setError,
  })

  const remove = useMutation({
    mutationFn: (commentId: CommentId) =>
      callApi((api) => api.docs.deleteComment({ params: { commentId } })),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError: setError,
  })

  if (loading) return <LoadingRows />

  const topLevel = comments.filter((comment) => comment.parentCommentId === null)
  const repliesOf = (id: CommentId) => comments.filter((comment) => comment.parentCommentId === id)

  return (
    <div className="space-y-4 pt-3">
      {error !== null && <ErrorMessage error={error} />}
      {canComment && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft.trim()
            if (text !== "") create.mutate({ text, parent: null })
          }}
        >
          {pending !== null && (
            <p className="rounded-md bg-muted p-2 text-xs">
              <Trans>On:</Trans> <q>{pending.quote}</q>{" "}
              <button type="button" className="underline" onClick={onPendingDone}>
                <Trans>Clear</Trans>
              </button>
            </p>
          )}
          <label htmlFor="comment-draft" className="sr-only">
            {t`New comment`}
          </label>
          <Textarea
            id="comment-draft"
            value={draft}
            maxLength={5000}
            placeholder={t`Add a comment`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={create.isPending || draft.trim() === ""}>
            <Trans>Comment</Trans>
          </Button>
        </form>
      )}
      {topLevel.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>No comments yet.</Trans>
        </p>
      )}
      <ul className="space-y-3">
        {topLevel.map((comment) => {
          const quote = comment.anchor?.["quote"]
          const resolved = comment.resolvedAt !== null
          return (
            <li key={comment.id} className="rounded-md border p-3 text-sm">
              {typeof quote === "string" && quote !== "" && (
                <q className="mb-2 block text-xs text-muted-foreground">{quote}</q>
              )}
              <p className={resolved ? "text-muted-foreground line-through" : undefined}>
                {comment.bodyText}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {canComment && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                  >
                    <Trans>Reply</Trans>
                  </button>
                )}
                {canComment && (
                  <button
                    type="button"
                    className="underline"
                    disabled={update.isPending}
                    onClick={() => update.mutate(comment)}
                  >
                    {resolved ? <Trans>Reopen</Trans> : <Trans>Resolve</Trans>}
                  </button>
                )}
                {(canManage || comment.authorId === currentUserId) && (
                  <button
                    type="button"
                    className="text-destructive underline"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(comment.id)}
                  >
                    <Trans>Delete</Trans>
                  </button>
                )}
              </div>
              {repliesOf(comment.id).length > 0 && (
                <ul className="mt-3 space-y-2 border-l pl-3">
                  {repliesOf(comment.id).map((reply) => (
                    <li key={reply.id} className="text-sm">
                      {reply.bodyText}
                      {(canManage || reply.authorId === currentUserId) && (
                        <button
                          type="button"
                          className="ml-2 text-xs text-destructive underline"
                          onClick={() => remove.mutate(reply.id)}
                        >
                          <Trans>Delete</Trans>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {replyTo === comment.id && (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const text = replyDraft.trim()
                    if (text !== "") create.mutate({ text, parent: comment.id })
                  }}
                >
                  <label htmlFor={`reply-${comment.id}`} className="sr-only">
                    {t`Reply`}
                  </label>
                  <Textarea
                    id={`reply-${comment.id}`}
                    value={replyDraft}
                    maxLength={5000}
                    onChange={(event) => setReplyDraft(event.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={create.isPending}>
                    <Trans>Reply</Trans>
                  </Button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
