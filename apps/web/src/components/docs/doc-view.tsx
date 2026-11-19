import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DocDetail, DocNode } from "@audit/domain/docs/schema"
import type { DocId, ProjectId } from "@audit/domain/ids"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@audit/ui/components/ui/dialog.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@audit/ui/components/ui/tabs.tsx"
import { callApi } from "../../lib/api.ts"
import { sessionQuery } from "../../lib/queries.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import type { AnchorRange } from "./comments-anchor.ts"
import { CommentsPanel, type PendingAnchor } from "./comments-panel.tsx"
import { DocEditor } from "./collab-editor.tsx"
import { docQuery, commentsQuery, invalidateDoc } from "./queries.ts"
import { VersionsPanel } from "./versions-panel.tsx"
import { BacklinksPanel } from "./backlinks-panel.tsx"
import { useRecordRecent } from "../../lib/search.ts"

interface DocViewProps {
  readonly docId: DocId
  readonly projectId: ProjectId | null
  readonly projectKey: string | null
  readonly template: string | undefined
}

/** Loads the doc and the caller's identity, then renders the page. */
export const DocView = ({ docId, projectId, projectKey, template }: DocViewProps) => {
  const detail = useQuery(docQuery(docId))
  useRecordRecent(docId)
  const session = useQuery(sessionQuery)
  if (detail.isPending || session.isPending) return <LoadingRows />
  if (detail.isError) return <ErrorMessage error={detail.error} />
  if (session.isError) return <ErrorMessage error={session.error} />
  if (session.data === null) return <LoadingRows />
  return (
    <DocBody
      doc={detail.data}
      projectId={projectId}
      projectKey={projectKey}
      template={template}
      me={{ id: session.data.userId, name: session.data.displayName }}
    />
  )
}

const PALETTE = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2"]

/** A stable caret colour per user, so co-editors can tell each other apart. */
const colorFor = (seed: string) => {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0] ?? "#2563eb"
}

const DAY_MS = 86_400_000

/** Whether a doc with a review interval is due. `null` interval means review is off. */
export const reviewState = (
  doc: Pick<DocNode, "reviewEveryDays" | "verifiedAt">,
  now: number,
): "off" | "due" | "current" => {
  if (doc.reviewEveryDays === null) return "off"
  if (doc.verifiedAt === null) return "due"
  const verified = new Date(doc.verifiedAt).getTime()
  return verified + doc.reviewEveryDays * DAY_MS < now ? "due" : "current"
}

const DocBody = ({
  doc,
  projectId,
  projectKey,
  template,
  me,
}: {
  readonly doc: DocDetail
  readonly projectId: ProjectId | null
  readonly projectKey: string | null
  readonly template: string | undefined
  readonly me: { readonly id: string; readonly name: string }
}) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const docId = doc.id
  const role = doc.myRole
  const canWrite = role === "manager" || role === "editor"
  const canComment = canWrite || role === "commenter"
  const comments = useQuery(commentsQuery(docId))
  const [pending, setPending] = useState<PendingAnchor | null>(null)
  const [title, setTitle] = useState(doc.title)
  const [error, setError] = useState<unknown>(null)

  const anchors: ReadonlyArray<AnchorRange> = (comments.data ?? []).flatMap((comment) => {
    const anchor = comment.anchor
    if (comment.resolvedAt !== null || comment.parentCommentId !== null || anchor === null)
      return []
    const { from, to } = anchor
    return typeof from === "string" && typeof to === "string" ? [{ id: comment.id, from, to }] : []
  })

  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      setError(null)
      void invalidateDoc(queryClient, docId)
    },
    onError: setError,
  })

  const [now] = useState(() => Date.now())
  const state = reviewState(doc, now)
  const isManager = role === "manager"

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {doc.icon !== null && doc.icon !== undefined && (
            <span aria-hidden="true" className="text-2xl">
              {doc.icon}
            </span>
          )}
          {canWrite ? (
            <Input
              aria-label={t`Document title`}
              value={title}
              maxLength={200}
              className="h-auto min-w-0 flex-1 border-none px-0 text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0 md:text-2xl"
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                const next = title.trim()
                if (next === "" || next === doc.title) return setTitle(doc.title)
                run.mutate(() =>
                  callApi((api) =>
                    api.docs.rename({
                      params: { docId },
                      payload: { title: next, version: doc.version },
                    }),
                  ),
                )
              }}
            />
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2 print:hidden">
            <a
              href={`/api/docs/${docId}/export/md`}
              download
              className="text-sm text-primary underline"
            >
              <Trans>Export Markdown</Trans>
            </a>
            <a
              href={`/api/docs/${docId}/export/html`}
              download
              className="text-sm text-primary underline"
            >
              <Trans>Export HTML</Trans>
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
          {state === "due" && (
            <Badge variant="destructive">
              <Trans>Needs review</Trans>
            </Badge>
          )}
          {state === "current" && (
            <Badge variant="secondary">
              <Trans>Verified</Trans>
            </Badge>
          )}
          {doc.verifiedAt !== null && doc.verifiedAt !== undefined && (
            <span className="text-muted-foreground">
              <Trans>Verified on {new Date(doc.verifiedAt).toLocaleDateString()}</Trans>
            </span>
          )}
          {(canWrite || isManager) && state !== "off" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={run.isPending}
              onClick={() =>
                run.mutate(() => callApi((api) => api.docs.verify({ params: { docId } })))
              }
            >
              <Trans>Mark verified</Trans>
            </Button>
          )}
          {isManager && (
            <ReviewSettingsDialog
              reviewEveryDays={doc.reviewEveryDays}
              disabled={run.isPending}
              onSave={(reviewEveryDays) =>
                run.mutate(() =>
                  callApi((api) =>
                    api.docs.setReview({
                      params: { docId },
                      payload: { reviewEveryDays, ownerUserId: doc.ownerUserId },
                    }),
                  ),
                )
              }
            />
          )}
        </div>
        {error !== null && <ErrorMessage error={error} />}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0">
          <DocEditor
            docId={docId}
            projectId={projectId}
            role={role}
            user={{ name: me.name, color: colorFor(me.id) }}
            comments={anchors}
            template={template}
            onSelectionComment={(anchor, quote) => {
              if (canComment) setPending({ ...anchor, quote })
            }}
          />
        </div>
        <aside className="min-w-0 print:hidden">
          <Tabs defaultValue="comments">
            <TabsList className="w-full">
              <TabsTrigger value="comments">
                <Trans>Comments</Trans>
              </TabsTrigger>
              <TabsTrigger value="versions">
                <Trans>Versions</Trans>
              </TabsTrigger>
              <TabsTrigger value="backlinks">
                <Trans>Backlinks</Trans>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="comments">
              <CommentsPanel
                docId={docId}
                comments={comments.data ?? []}
                loading={comments.isPending}
                canComment={canComment}
                canManage={canWrite}
                pending={pending}
                onPendingDone={() => setPending(null)}
                currentUserId={me.id}
              />
            </TabsContent>
            <TabsContent value="versions">
              <VersionsPanel docId={docId} canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="backlinks">
              <BacklinksPanel entityId={docId} projectKey={projectKey} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  )
}

const ReviewSettingsDialog = ({
  reviewEveryDays,
  disabled,
  onSave,
}: {
  readonly reviewEveryDays: number | null
  readonly disabled: boolean
  readonly onSave: (reviewEveryDays: number | null) => void
}) => {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState("")
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDays(reviewEveryDays === null ? "" : String(reviewEveryDays))
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Trans>Document settings</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(days.trim() === "" ? null : Number(days))
            setOpen(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>
              <Trans>Document settings</Trans>
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="review-days">
              <Trans>Review every (days)</Trans>
            </Label>
            <Input
              id="review-days"
              type="number"
              min={1}
              max={3650}
              value={days}
              aria-label={t`Review every (days)`}
              onChange={(event) => setDays(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" size="sm">
              <Trans>Save</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
