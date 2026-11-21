import { useRef, useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftRight, BookOpen, Maximize2, Minimize2, Pencil, X } from "lucide-react"
import type { Editor } from "@tiptap/core"
import type { DocDetail } from "@audit/domain/docs/schema"
import type { DocId, ProjectId } from "@audit/domain/ids"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { ToggleGroup, ToggleGroupItem } from "@audit/ui/components/ui/toggle-group.tsx"
import { callApi } from "../../lib/api.ts"
import { sessionQuery } from "../../lib/queries.ts"
import { useRecordRecent } from "../../lib/search.ts"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { EntityActionsButton } from "../actions/entity-menu.tsx"
import { useAiPageContext } from "../ai/ai-store.ts"
import type { AnchorRange } from "./comments-anchor.ts"
import { DocEditor } from "./collab-editor.tsx"
import { DocAiMenu } from "./doc-ai-menu.tsx"
import { openTab } from "./doc-tabs.ts"
import { Tooltip, TooltipContent, TooltipTrigger } from "@audit/ui/components/ui/tooltip.tsx"
import { PropertiesPanel } from "./properties-panel.tsx"
import { commentsQuery, docQuery, invalidateDoc } from "./queries.ts"

/** Stable caret colour per user, so co-editors can tell each other apart. */
const PALETTE = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2"]

const colorFor = (seed: string) => {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0] ?? "#2563eb"
}

/** Anchors of open, top-level comments, as decorations for the editor. */
const anchorsOf = (
  comments: ReadonlyArray<{
    id: string
    resolvedAt: unknown
    parentCommentId: unknown
    anchor: { from?: unknown; to?: unknown } | null
  }>,
): ReadonlyArray<AnchorRange> =>
  comments.flatMap((comment) => {
    const anchor = comment.anchor
    if (comment.resolvedAt !== null || comment.parentCommentId !== null || anchor === null)
      return []
    const { from, to } = anchor
    return typeof from === "string" && typeof to === "string" ? [{ id: comment.id, from, to }] : []
  })

export interface DocEditorPaneProps {
  readonly docId: DocId
  readonly projectId: ProjectId | null
  readonly projectKey: string | null
  readonly template?: string | undefined
  /** The main pane shows properties and reports its editor and comment selections to the workspace. */
  readonly primary: boolean
  /** Effective reading mode (read-only users are always reading). */
  readonly reading: boolean
  readonly onReadingChange: (reading: boolean) => void
  readonly onEditor?: ((editor: Editor | null) => void) | undefined
  readonly onSelectionComment?:
    | ((anchor: { from: string; to: string }, quote: string) => void)
    | undefined
  readonly onOpenSide?: (() => void) | undefined
  readonly onNewSubDoc?: (() => void) | undefined
  readonly focused?: boolean | undefined
  readonly onToggleFocus?: (() => void) | undefined
  readonly onSplit?: { readonly onClose: () => void; readonly onSwap: () => void } | undefined
}

/** One document with its header, properties, and collaborative editor. Used for the main and split panes. */
export const DocEditorPane = (props: DocEditorPaneProps) => {
  const detail = useQuery(docQuery(props.docId))
  const session = useQuery(sessionQuery)
  useRecordRecent(props.docId)
  if (detail.isPending || session.isPending) return <LoadingRows />
  if (detail.isError) return <ErrorMessage error={detail.error} />
  if (session.isError) return <ErrorMessage error={session.error} />
  if (session.data === null) return <LoadingRows />
  return (
    <DocPaneBody
      {...props}
      doc={detail.data}
      me={{ id: session.data.userId, name: session.data.displayName }}
    />
  )
}

const DocPaneBody = ({
  doc,
  me,
  docId,
  projectId,
  projectKey,
  template,
  primary,
  reading,
  onReadingChange,
  onEditor,
  onSelectionComment,
  onOpenSide,
  onNewSubDoc,
  focused,
  onToggleFocus,
  onSplit,
}: DocEditorPaneProps & {
  readonly doc: DocDetail
  readonly me: { readonly id: string; readonly name: string }
}) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const role = doc.myRole
  const canWrite = role === "manager" || role === "editor"
  const canComment = canWrite || role === "commenter"
  const isManager = role === "manager"
  const comments = useQuery(commentsQuery(docId))
  const [title, setTitle] = useState(doc.title)
  const [error, setError] = useState<unknown>(null)
  const [presence, setPresence] = useState<
    ReadonlyArray<{ readonly name: string; readonly color: string }>
  >([])
  const editorRef = useRef<Editor | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  useAiPageContext(docId)
  const anchors = anchorsOf(comments.data ?? [])
  const editing = canWrite && !reading

  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      setError(null)
      void invalidateDoc(queryClient, docId)
    },
    onError: setError,
  })

  const readingMode = !editing

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex min-w-0 items-start gap-2">
          {doc.icon !== null && doc.icon !== undefined && (
            <span aria-hidden="true" className="text-2xl">
              {doc.icon}
            </span>
          )}
          {canWrite ? (
            <Input
              ref={titleRef}
              aria-label={t`Document title`}
              value={title}
              maxLength={200}
              className="h-auto min-w-0 flex-1 truncate border-none bg-transparent px-0 text-xl font-semibold tracking-tight shadow-none focus-visible:ring-0 dark:bg-transparent md:text-2xl"
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
            <h1 className="line-clamp-2 min-w-0 flex-1 break-words text-xl font-semibold tracking-tight md:text-2xl">
              {doc.title}
            </h1>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 print:hidden">
          {canWrite && (
            <ToggleGroup
              type="single"
              variant="outline"
              value={editing ? "edit" : "read"}
              aria-label={t`Editing mode`}
              onValueChange={(value) => {
                if (value !== "") onReadingChange(value === "read")
              }}
            >
              <ToggleGroupItem value="edit" aria-label={t`Edit`}>
                <Pencil aria-hidden="true" />
                <span>
                  <Trans>Edit</Trans>
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem value="read" aria-label={t`Read`}>
                <BookOpen aria-hidden="true" />
                <span>
                  <Trans>Read</Trans>
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {primary && onToggleFocus !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={focused === true ? t`Exit focus mode` : t`Focus mode`}
              title={focused === true ? t`Exit focus mode` : t`Focus mode`}
              onClick={onToggleFocus}
            >
              {focused === true ? (
                <Minimize2 aria-hidden="true" />
              ) : (
                <Maximize2 aria-hidden="true" />
              )}
            </Button>
          )}
          {onSplit !== undefined && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t`Swap panes`}
                    onClick={onSplit.onSwap}
                  >
                    <ArrowLeftRight aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t`Swap panes`}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t`Close split`}
                    onClick={onSplit.onClose}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t`Close split`}</TooltipContent>
              </Tooltip>
            </>
          )}
          <DocAiMenu docId={docId} title={doc.title} canWrite={canWrite} editorRef={editorRef} />
          <EntityActionsButton
            label={t`Actions for ${doc.title}`}
            target={{
              kind: "doc",
              doc,
              projectKey: projectKey ?? undefined,
              onRename: () => titleRef.current?.focus(),
              onOpenTab: () => openTab({ id: docId, projectKey }),
              onOpenSide,
              onNewSubDoc,
              onOpenProperties: () => {
                const panel = document.getElementById("doc-properties")
                panel?.scrollIntoView({ block: "start" })
                panel?.querySelector<HTMLElement>("button, input, select, [role=combobox]")?.focus()
              },
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm print:hidden">
          <a href={`/api/docs/${docId}/export/md`} download className="inline-flex min-h-11 items-center text-link underline md:min-h-6">
            <Trans>Export Markdown</Trans>
          </a>
          <a href={`/api/docs/${docId}/export/html`} download className="inline-flex min-h-11 items-center text-link underline md:min-h-6">
            <Trans>Export HTML</Trans>
          </a>
          {presence.length > 0 && (
            <ul aria-label={t`Also here`} className="ms-auto flex items-center -space-x-1">
              {presence.map((user, index) => (
                <li
                  key={`${user.name}-${index}`}
                  title={user.name}
                  className="inline-flex size-6 items-center justify-center rounded-full border border-background text-[11px] font-medium text-white"
                  style={{ backgroundColor: user.color }}
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </li>
              ))}
            </ul>
          )}
        </div>
        {error !== null && <ErrorMessage error={error} />}
      </header>

      {primary && (
        <div id="doc-properties" className="print:hidden">
          <PropertiesPanel
            doc={doc}
            projectKey={projectKey}
            canWrite={canWrite}
            isManager={isManager}
          />
        </div>
      )}

      <div
        className={
          readingMode ? "[&_.ProseMirror]:leading-8 [&_.ProseMirror]:caret-transparent" : undefined
        }
      >
        <DocEditor
          docId={docId}
          parentId={projectId ?? WORKSPACE_SPACE_ID}
          projectId={projectId}
          role={role}
          user={{ name: me.name, color: colorFor(me.id) }}
          comments={anchors}
          template={template}
          editorRef={editorRef}
          reading={readingMode}
          onPresence={setPresence}
          onEditor={onEditor}
          onSelectionComment={(anchor, quote) => {
            if (primary && canComment) onSelectionComment?.(anchor, quote)
          }}
        />
      </div>
    </div>
  )
}
