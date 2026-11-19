import { useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { UserId } from "@audit/domain/ids"
import type { Comment, RichDoc, TaskDetail } from "@audit/domain/tasks/schema"
import { roleAtLeast } from "@audit/domain/roles"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { callApi } from "../../lib/api.ts"
import { membersQuery } from "../../lib/queries.ts"
import { ErrorMessage } from "../feedback.tsx"
import { RichEditor } from "./rich-editor.tsx"
import { invalidateTask } from "./queries.ts"
import { emptyDoc, richText } from "./rich-text.ts"

interface CommentsSectionProps {
  readonly task: TaskDetail
  readonly currentUserId: UserId | null
  readonly canComment: boolean
}

export function CommentsSection({ task, currentUserId, canComment }: CommentsSectionProps) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery)
  const [draft, setDraft] = useState<RichDoc>(emptyDoc)
  const [composerKey, setComposerKey] = useState(0)

  const create = useMutation({
    mutationFn: (body: RichDoc) =>
      callApi((api) => api.tasks.createComment({ params: { taskId: task.id }, payload: { body } })),
    onSuccess: async () => {
      setDraft(emptyDoc)
      setComposerKey((value) => value + 1)
      await invalidateTask(queryClient, task.id)
    },
  })

  const roots = task.comments.filter((comment) => comment.parentCommentId === null)
  const repliesOf = (parentId: string) =>
    task.comments.filter((comment) => comment.parentCommentId === parentId)
  const authorName = (userId: UserId) =>
    members.data?.find((member) => member.userId === userId)?.displayName ?? t`Unknown user`
  const canManage = roleAtLeast(task.myRole, "manager")
  const isEmpty = richText(draft).trim().length === 0

  return (
    <section aria-labelledby="task-comments-heading" className="space-y-4">
      <h2 id="task-comments-heading" className="text-base font-semibold">
        {t`Comments`}
      </h2>
      {roots.length === 0 && <p className="text-sm text-muted-foreground">{t`No comments yet.`}</p>}
      <ul className="space-y-4">
        {roots.map((comment) => (
          <CommentThread
            key={comment.id}
            task={task}
            comment={comment}
            replies={repliesOf(comment.id)}
            authorName={authorName}
            currentUserId={currentUserId}
            canComment={canComment}
            canManage={canManage}
          />
        ))}
      </ul>
      {canComment && (
        <div className="space-y-2">
          <RichEditor
            key={composerKey}
            value={emptyDoc}
            editable
            label={t`New comment`}
            onChange={setDraft}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={isEmpty || create.isPending}
              onClick={() => create.mutate(draft)}
            >
              {t`Post comment`}
            </Button>
          </div>
          {create.error !== null && <ErrorMessage error={create.error} />}
        </div>
      )}
    </section>
  )
}

function CommentThread({
  task,
  comment,
  replies,
  authorName,
  currentUserId,
  canComment,
  canManage,
}: {
  readonly task: TaskDetail
  readonly comment: Comment
  readonly replies: ReadonlyArray<Comment>
  readonly authorName: (userId: UserId) => string
  readonly currentUserId: UserId | null
  readonly canComment: boolean
  readonly canManage: boolean
}) {
  return (
    <li className="space-y-3">
      <CommentItem
        task={task}
        comment={comment}
        authorName={authorName}
        currentUserId={currentUserId}
        canComment={canComment}
        canManage={canManage}
      />
      {replies.length > 0 && (
        <ul className="ml-6 space-y-3 border-l pl-4">
          {replies.map((reply) => (
            <li key={reply.id}>
              <CommentItem
                task={task}
                comment={reply}
                authorName={authorName}
                currentUserId={currentUserId}
                canComment={canComment}
                canManage={canManage}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function CommentItem({
  task,
  comment,
  authorName,
  currentUserId,
  canComment,
  canManage,
}: {
  readonly task: TaskDetail
  readonly comment: Comment
  readonly authorName: (userId: UserId) => string
  readonly currentUserId: UserId | null
  readonly canComment: boolean
  readonly canManage: boolean
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<RichDoc | null>(null)
  const [replying, setReplying] = useState<RichDoc | null>(null)
  const [replyKey, setReplyKey] = useState(0)
  const isOwn = comment.authorId === currentUserId
  const isResolved = comment.resolvedAt !== null

  const refresh = () => invalidateTask(queryClient, task.id)

  const reply = useMutation({
    mutationFn: (body: RichDoc) =>
      callApi((api) =>
        api.tasks.createComment({
          params: { taskId: task.id },
          payload: { body, parentCommentId: comment.id },
        }),
      ),
    onSuccess: async () => {
      setReplying(null)
      setReplyKey((value) => value + 1)
      await refresh()
    },
  })

  const edit = useMutation({
    mutationFn: (body: RichDoc) =>
      callApi((api) =>
        api.tasks.updateComment({
          params: { commentId: comment.id },
          payload: { body, version: comment.version },
        }),
      ),
    onSuccess: async () => {
      setEditing(null)
      await refresh()
    },
  })

  const resolve = useMutation({
    mutationFn: (resolved: boolean) =>
      callApi((api) =>
        api.tasks.updateComment({
          params: { commentId: comment.id },
          payload: { resolved, version: comment.version },
        }),
      ),
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: () =>
      callApi((api) => api.tasks.deleteComment({ params: { commentId: comment.id } })),
    onSuccess: refresh,
  })

  const error = reply.error ?? edit.error ?? resolve.error ?? remove.error
  const busy = reply.isPending || edit.isPending || resolve.isPending || remove.isPending

  return (
    <article aria-label={t`Comment by ${authorName(comment.authorId)}`} className="space-y-2">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{authorName(comment.authorId)}</span>
        <time className="text-muted-foreground" dateTime={comment.createdAt.toISOString()}>
          {comment.createdAt.toLocaleString()}
        </time>
        {comment.editedAt !== null && <span className="text-muted-foreground">{t`(edited)`}</span>}
        {isResolved && <Badge variant="secondary">{t`Resolved`}</Badge>}
      </header>

      {editing === null ? (
        <RichEditor
          key={comment.version}
          value={comment.body}
          editable={false}
          label={t`Comment`}
        />
      ) : (
        <RichEditor value={comment.body} editable label={t`Edit comment`} onChange={setEditing} />
      )}

      <div className="flex flex-wrap gap-2">
        {canComment && !isResolved && editing === null && comment.parentCommentId === null && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setReplying(emptyDoc)}>
            {t`Reply`}
          </Button>
        )}
        {canComment && comment.parentCommentId === null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => resolve.mutate(!isResolved)}
          >
            {isResolved ? t`Reopen` : t`Resolve`}
          </Button>
        )}
        {isOwn && editing === null && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(comment.body)}>
            {t`Edit`}
          </Button>
        )}
        {editing !== null && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
              {t`Cancel`}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || richText(editing).trim().length === 0}
              onClick={() => edit.mutate(editing)}
            >
              {t`Save comment`}
            </Button>
          </>
        )}
        {(isOwn || canManage) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => remove.mutate()}
          >
            {t`Delete`}
          </Button>
        )}
      </div>

      {replying !== null && (
        <div className="space-y-2">
          <RichEditor
            key={replyKey}
            value={emptyDoc}
            editable
            label={t`Reply`}
            onChange={setReplying}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplying(null)}>
              {t`Cancel`}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || richText(replying).trim().length === 0}
              onClick={() => reply.mutate(replying)}
            >
              {t`Post reply`}
            </Button>
          </div>
        </div>
      )}

      {error !== null && error !== undefined && <ErrorMessage error={error} />}
    </article>
  )
}
