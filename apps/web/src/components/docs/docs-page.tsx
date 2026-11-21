import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { ListTree, Link2, MessageSquare, History, PanelRight, X } from "lucide-react"
import type { Editor } from "@tiptap/core"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { DocNode } from "@audit/domain/docs/schema"
import type { DocId, EntityId, ProjectId } from "@audit/domain/ids"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@audit/ui/components/ui/drawer.tsx"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@audit/ui/components/ui/resizable.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@audit/ui/components/ui/tabs.tsx"
import { useSidebar } from "@audit/ui/components/ui/sidebar.tsx"
import { EntityContextMenu } from "../actions/entity-menu.tsx"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { docHref } from "../../lib/entity-links.ts"
import { sessionQuery } from "../../lib/queries.ts"
import { usePersistedBoolean } from "./persisted.ts"
import { DocEditorPane } from "./doc-editor-pane.tsx"
import { DocTree } from "./doc-tree.tsx"
import {
  neighbourAfterClose,
  closeTab,
  openTab,
  setTabReading,
  useDocTabs,
  type DocTab,
} from "./doc-tabs.ts"
import { setDocFocus, toggleDocFocus, useDocFocus } from "./docs-focus.ts"
import { CommentsPanel, type PendingAnchor } from "./comments-panel.tsx"
import { VersionsPanel } from "./versions-panel.tsx"
import { OutlinePane } from "./outline-pane.tsx"
import { LinksPane } from "./links-pane.tsx"
import { NewDocDialog } from "./new-doc-dialog.tsx"
import { commentsQuery, docQuery, docTreeQuery } from "./queries.ts"

interface DocsWorkspaceProps {
  /** `null` for the workspace space, otherwise the project whose docs are shown. */
  readonly projectId: ProjectId | null
  readonly projectKey: string | null
  readonly docId: DocId | null
  /** Doc opened beside the main one (route search `split`). Desktop only. */
  readonly split?: DocId | undefined
  readonly onSplitChange: (split: DocId | undefined) => void
  /** Template chosen when the doc was created; applied by the editor on first open. */
  readonly template?: string | undefined
  /** Id of a new-doc request from elsewhere (for example the command palette). */
  readonly newRequest?: string | undefined
}

/** Subscribes to a media query; `false` on the server. */
const useMedia = (query: string) =>
  useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", notify)
      return () => list.removeEventListener("change", notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )

const insideOverlay = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("[role='dialog'],[role='menu'],[role='listbox']") !== null

/**
 * Docs workspace (Obsidian-style): doc tree, tabbed editor with an optional split, and a right pane
 * for outline, links, comments and versions. The same page serves the space and each project.
 */
export const DocsWorkspace = ({
  projectId,
  projectKey,
  docId,
  split,
  onSplitChange,
  template,
  newRequest,
}: DocsWorkspaceProps) => {
  const { t } = useLingui()
  const tree = useQuery(docTreeQuery(projectId))
  const session = useQuery(sessionQuery)
  const hrefFor = (id: DocId) => docHref(id, projectKey)
  const parentId: EntityId = projectId ?? WORKSPACE_SPACE_ID
  const indexHref = projectKey === null ? "/docs" : `/p/${projectKey}/docs`
  const md = useMedia("(min-width: 768px)")
  const wide = useMedia("(min-width: 1024px)")
  const focused = useDocFocus()
  const tabs = useDocTabs()
  const navigate = useNavigate()
  const sidebar = useSidebar()
  const sidebarOpen = sidebar.open
  const setSidebarOpen = sidebar.setOpen
  const [treeOpen, setTreeOpen] = usePersistedBoolean("audit.docs.tree", true)
  const [paneOpen, setPaneOpen] = usePersistedBoolean("audit.docs.pane", true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pending, setPending] = useState<PendingAnchor | null>(null)
  const [rightTab, setRightTab] = useState("outline")
  const [subNew, setSubNew] = useState<{
    readonly parent: EntityId
    readonly request: string
    readonly forNewRequest: string | undefined
  } | null>(null)
  // A sub-doc request only applies to the `new` request it was created for.
  const activeSubNew = subNew !== null && subNew.forNewRequest === newRequest ? subNew : null
  const sidebarBeforeFocus = useRef<boolean | null>(null)

  // Open the active doc as a tab, and the split doc beside it.
  useEffect(() => {
    if (docId !== null) openTab({ id: docId, projectKey })
  }, [docId, projectKey])
  useEffect(() => {
    if (split !== undefined) openTab({ id: split, projectKey })
  }, [split, projectKey])

  // Focus mode collapses the app sidebar and restores its previous state on exit.
  useEffect(() => {
    if (focused && sidebarBeforeFocus.current === null) {
      sidebarBeforeFocus.current = sidebarOpen
      setSidebarOpen(false)
    } else if (!focused && sidebarBeforeFocus.current !== null) {
      setSidebarOpen(sidebarBeforeFocus.current)
      sidebarBeforeFocus.current = null
    }
  }, [focused, sidebarOpen, setSidebarOpen])
  useEffect(
    () => () => {
      setDocFocus(false)
    },
    [],
  )

  const docs: ReadonlyArray<DocNode> = tree.data ?? []
  const activeTab = tabs.tabs.find((tab) => tab.id === docId)
  const reading = activeTab?.reading ?? false

  // Making the editor read-only drops focus to <body>; keep Ctrl+E working from there.
  useEffect(() => {
    if (docId === null) return
    const onBodyKey = (event: KeyboardEvent) => {
      if (document.activeElement !== document.body) return
      if (event.code !== "KeyE" || !(event.ctrlKey || event.metaKey)) return
      if (event.altKey || event.shiftKey) return
      event.preventDefault()
      setTabReading(docId, !reading)
    }
    document.addEventListener("keydown", onBodyKey)
    return () => document.removeEventListener("keydown", onBodyKey)
  }, [docId, reading])

  const openSide = (id: DocId) => {
    if (id === docId) return
    onSplitChange(id)
  }

  const swap = () => {
    if (docId === null || split === undefined) return
    void navigate({ to: docHref(split, projectKey), search: { split: docId } })
  }

  const closeDocTab = (id: DocId) => {
    const next = neighbourAfterClose(tabs.tabs, id)
    closeTab(id)
    if (id === split) onSplitChange(undefined)
    if (id !== docId) return
    if (next === null) {
      void navigate({ to: indexHref })
      return
    }
    const nextTab = tabs.tabs.find((tab) => tab.id === next)
    void navigate({ to: docHref(next, nextTab?.projectKey ?? null) })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && focused && !insideOverlay(event.target)) {
      setDocFocus(false)
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.code === "KeyE" && !event.altKey && !event.shiftKey && docId !== null) {
      event.preventDefault()
      event.stopPropagation()
      setTabReading(docId, !reading)
    } else if (event.code === "Period" && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      toggleDocFocus()
    } else if (event.code === "KeyW" && event.altKey && docId !== null) {
      event.preventDefault()
      event.stopPropagation()
      closeDocTab(docId)
    } else if (event.code === "Tab" && wide && docId !== null && tabs.tabs.length > 1) {
      event.preventDefault()
      event.stopPropagation()
      const count = tabs.tabs.length
      const index = tabs.tabs.findIndex((tab) => tab.id === docId)
      const step = event.shiftKey ? -1 : 1
      const next = tabs.tabs[(index + step + count) % count]
      if (next !== undefined) void navigate({ to: docHref(next.id, next.projectKey) })
    }
  }

  const treeBody = tree.isPending ? (
    <LoadingRows />
  ) : tree.isError ? (
    <ErrorMessage error={tree.error} />
  ) : (
    <div className="space-y-3">
      <NewDocDialog
        parentId={activeSubNew?.parent ?? parentId}
        hrefFor={hrefFor}
        requestId={activeSubNew?.request ?? newRequest}
      />
      <DocTree
        docs={tree.data}
        activeDocId={docId}
        hrefFor={hrefFor}
        projectKey={projectKey ?? undefined}
        onOpenSide={openSide}
      />
    </div>
  )

  const primaryPane =
    docId === null ? null : (
      <DocEditorPane
        key={docId}
        docId={docId}
        projectId={projectId}
        projectKey={projectKey}
        template={template}
        primary
        reading={reading}
        onReadingChange={(next) => setTabReading(docId, next)}
        onEditor={setEditor}
        onSelectionComment={(anchor, quote) => {
          setPending({ ...anchor, quote })
          setRightTab("comments")
        }}
        onNewSubDoc={() =>
          setSubNew({ parent: docId, request: crypto.randomUUID(), forNewRequest: newRequest })
        }
        focused={focused}
        onToggleFocus={toggleDocFocus}
      />
    )

  const secondaryPane =
    split === undefined ? null : (
      <DocEditorPane
        key={split}
        docId={split}
        projectId={projectId}
        projectKey={projectKey}
        primary={false}
        reading={tabs.tabs.find((tab) => tab.id === split)?.reading ?? false}
        onReadingChange={(next) => setTabReading(split, next)}
        onSplit={{ onClose: () => onSplitChange(undefined), onSwap: swap }}
      />
    )

  const tabBar = wide && !focused && tabs.tabs.length > 0 && (
    <DocTabBar
      tabs={tabs.tabs}
      activeId={docId}
      docs={docs}
      projectKey={projectKey}
      onClose={closeDocTab}
    />
  )

  const editorColumn = (
    <div className={`flex min-w-0 flex-col gap-3 ${focused ? "mx-auto w-full max-w-3xl" : ""}`}>
      {tabBar}
      {docId === null ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Select a document to read or edit it.</Trans>
        </p>
      ) : split !== undefined && wide ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-[60vh]">
          <ResizablePanel defaultSize="50%" minSize="30%" className="min-w-0 pe-3">
            {primaryPane}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="50%" minSize="30%" className="min-w-0 ps-3">
            {secondaryPane}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        primaryPane
      )}
    </div>
  )

  const rightPane =
    docId === null ? null : (
      <DocRightPane
        docId={docId}
        tab={rightTab}
        onTabChange={setRightTab}
        editor={editor}
        pending={pending}
        onPendingDone={() => setPending(null)}
        currentUserId={session.data?.userId ?? null}
      />
    )

  return (
    <div className="flex min-h-0 flex-col print:block" onKeyDownCapture={onKeyDown}>
      {md ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-[70vh]">
          {!focused && (
            <>
              <ResizablePanel
                id="docs-tree"
                defaultSize={treeOpen ? "20%" : "0%"}
                minSize="14%"
                collapsible
                collapsedSize="0%"
                onResize={(size) => setTreeOpen(size.asPercentage > 0)}
                className="min-w-0 pe-3"
              >
                <aside aria-label={t`Documents`} className="print:hidden">
                  {treeBody}
                </aside>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          <ResizablePanel defaultSize="56%" minSize="30%" className="min-w-0 px-3">
            {editorColumn}
          </ResizablePanel>
          {!focused && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="docs-pane"
                defaultSize={paneOpen ? "24%" : "0%"}
                minSize="18%"
                collapsible
                collapsedSize="0%"
                onResize={(size) => setPaneOpen(size.asPercentage > 0)}
                className="min-w-0 ps-3"
              >
                <section aria-label={t`Document panel`} className="print:hidden">
                  {rightPane}
                </section>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      ) : (
        <div className="space-y-3">
          {!focused && (
            <div className="flex items-center gap-2 print:hidden">
              <Drawer direction="left">
                <DrawerTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8">
                    <ListTree aria-hidden="true" />
                    <Trans>Documents</Trans>
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>
                      <Trans>Documents</Trans>
                    </DrawerTitle>
                  </DrawerHeader>
                  <div className="max-h-[75vh] overflow-y-auto p-4">{treeBody}</div>
                </DrawerContent>
              </Drawer>
              <Drawer>
                <DrawerTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8">
                    <PanelRight aria-hidden="true" />
                    <Trans>Panel</Trans>
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>
                      <Trans>Panel</Trans>
                    </DrawerTitle>
                  </DrawerHeader>
                  <div className="max-h-[70vh] overflow-y-auto p-4">{rightPane}</div>
                </DrawerContent>
              </Drawer>
            </div>
          )}
          {editorColumn}
        </div>
      )}
    </div>
  )
}

interface DocTabBarProps {
  readonly tabs: ReadonlyArray<DocTab>
  readonly activeId: DocId | null
  readonly docs: ReadonlyArray<DocNode>
  readonly projectKey: string | null
  readonly onClose: (id: DocId) => void
}

/** Open doc tabs. Middle-click or the close button closes a tab. */
const DocTabBar = ({ tabs, activeId, docs, onClose }: DocTabBarProps) => {
  const { t } = useLingui()
  return (
    <nav aria-label={t`Open documents`}>
      <ul className="flex min-w-0 items-end gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => {
          const node = docs.find((doc) => doc.id === tab.id)
          const active = tab.id === activeId
          const title = node?.title || t`Untitled`
          const link = (
            <Link
              aria-current={active ? "page" : undefined}
              to={docHref(tab.id, tab.projectKey)}
              className="focus-visible:ring-ring min-w-0 flex-1 truncate px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              {title}
            </Link>
          )
          return (
            <li
              key={tab.id}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                onClose(tab.id)
              }}
              className={`group flex max-w-56 min-w-0 shrink-0 items-center border-b-2 ${
                active ? "border-primary bg-accent/60" : "border-transparent hover:bg-accent/40"
              }`}
            >
              {node === undefined ? (
                link
              ) : (
                <EntityContextMenu
                  target={{ kind: "doc", doc: node, projectKey: tab.projectKey ?? undefined }}
                >
                  {link}
                </EntityContextMenu>
              )}
              <button
                type="button"
                aria-label={t`Close ${title}`}
                onClick={() => onClose(tab.id)}
                className="focus-visible:ring-ring me-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-100 focus-visible:ring-2 focus-visible:outline-none md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

interface DocRightPaneProps {
  readonly docId: DocId
  readonly tab: string
  readonly onTabChange: (tab: string) => void
  readonly editor: Editor | null
  readonly pending: PendingAnchor | null
  readonly onPendingDone: () => void
  readonly currentUserId: string | null
}

/** Outline, links, comments and versions for the main doc. */
const DocRightPane = ({
  docId,
  tab,
  onTabChange,
  editor,
  pending,
  onPendingDone,
  currentUserId,
}: DocRightPaneProps) => {
  const { t } = useLingui()
  const detail = useQuery(docQuery(docId))
  const comments = useQuery(commentsQuery(docId))
  if (detail.isPending) return <LoadingRows />
  if (detail.isError) return <ErrorMessage error={detail.error} />
  const role = detail.data.myRole
  const canWrite = role === "manager" || role === "editor"
  const canComment = canWrite || role === "commenter"
  return (
    <Tabs value={tab} onValueChange={onTabChange} className="@container min-w-0">
      <TabsList className="w-full justify-start overflow-x-auto" aria-label={t`Document panel`}>
        <TabsTrigger
          value="outline"
          aria-label={t`Outline`}
          title={t`Outline`}
          className="min-w-0 flex-none px-2 @[20rem]:flex-1"
        >
          <ListTree aria-hidden="true" className="size-4" />
          <span className="hidden @[20rem]:inline">
            <Trans>Outline</Trans>
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="links"
          aria-label={t`Links`}
          title={t`Links`}
          className="min-w-0 flex-none px-2 @[20rem]:flex-1"
        >
          <Link2 aria-hidden="true" className="size-4" />
          <span className="hidden @[20rem]:inline">
            <Trans>Links</Trans>
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="comments"
          aria-label={t`Comments`}
          title={t`Comments`}
          className="min-w-0 flex-none px-2 @[20rem]:flex-1"
        >
          <MessageSquare aria-hidden="true" className="size-4" />
          <span className="hidden @[20rem]:inline">
            <Trans>Comments</Trans>
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="versions"
          aria-label={t`Versions`}
          title={t`Versions`}
          className="min-w-0 flex-none px-2 @[20rem]:flex-1"
        >
          <History aria-hidden="true" className="size-4" />
          <span className="hidden @[20rem]:inline">
            <Trans>Versions</Trans>
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="outline">
        <OutlinePane editor={editor} />
      </TabsContent>
      <TabsContent value="links">
        <LinksPane docId={docId} editor={editor} />
      </TabsContent>
      <TabsContent value="comments">
        <CommentsPanel
          docId={docId}
          comments={comments.data ?? []}
          loading={comments.isPending}
          canComment={canComment}
          canManage={canWrite}
          pending={pending}
          onPendingDone={onPendingDone}
          currentUserId={currentUserId ?? ""}
        />
      </TabsContent>
      <TabsContent value="versions">
        <VersionsPanel docId={docId} canWrite={canWrite} />
      </TabsContent>
    </Tabs>
  )
}
