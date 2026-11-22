import { useEffect, useRef, useState, type ComponentProps } from "react"
import { useLingui } from "@lingui/react/macro"
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@audit/ui/components/ui/resizable.tsx"
import { ChatNav } from "../components/chat/chat-nav.tsx"
import { ChatListRail } from "../components/chat/chat-list-rail.tsx"
import { useMediaQuery, useWideScreen } from "../components/chat/use-wide-screen.ts"
import { PageBody, PageHeader } from "../components/feedback.tsx"

const PANEL_KEY = "audit.chatPanel"
const PANEL_ID = "chat-panel"

type PanelRef = Extract<ComponentProps<typeof ResizablePanel>["panelRef"], { current: unknown }>
type PanelHandle = PanelRef["current"]

type PanelLayout = Record<string, number>

function readPanelLayout(): PanelLayout | undefined {
  try {
    const raw = localStorage.getItem(PANEL_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" ? (parsed as PanelLayout) : undefined
  } catch {
    return undefined
  }
}

function writePanelLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(layout))
  } catch {
    // Storage unavailable: the panel simply falls back to its default size next visit.
  }
}

export const Route = createFileRoute("/_app/_chat")({
  component: ChatLayout,
})

/**
 * Chat is two columns from `md` up: the channel list beside the open conversation.
 * Below `md` the list is its own page at `/chat`, and conversations are full screen.
 */
function ChatLayout() {
  const { t } = useLingui()
  const { me } = Route.useRouteContext()
  const wide = useWideScreen()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const onList = pathname.replace(/\/$/, "") === "/chat"
  const xl = useMediaQuery("(min-width: 1280px)")
  const threadOpen = /^\/c\/[^/]+\/t\//.test(pathname)
  const collapseList = wide && threadOpen && !xl
  const listRef = useRef<PanelHandle>(null)
  const [listCollapsed, setListCollapsed] = useState(false)
  useEffect(() => {
    if (collapseList) listRef.current?.collapse()
    else listRef.current?.expand()
  }, [collapseList])

  if (wide) {
    return (
      <PageBody width="full" className="flex min-h-0 flex-1 flex-col p-0">
        <ResizablePanelGroup
          id={PANEL_ID}
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={readPanelLayout()}
          onLayoutChanged={(layout) => {
            // The thread collapse is not a user choice, so it is not persisted.
            if (!listCollapsed) writePanelLayout(layout)
          }}
        >
          <ResizablePanel
            id="chat-list"
            panelRef={listRef}
            defaultSize="22%"
            minSize="16%"
            maxSize="35%"
            collapsible
            collapsedSize="48px"
            onResize={() => setListCollapsed(listRef.current?.isCollapsed() ?? false)}
            className="min-w-0"
          >
            {listCollapsed ? (
              <ChatListRail meId={me.userId} />
            ) : (
              <div className="h-full border-e">
                <ChatNav meId={me.userId} />
              </div>
            )}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="chat-content" minSize="40%" className="flex min-w-0 flex-col">
            <Outlet />
          </ResizablePanel>
        </ResizablePanelGroup>
      </PageBody>
    )
  }

  if (onList) {
    return (
      <PageBody width="full" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <PageHeader title={t`Chat`} />
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatNav meId={me.userId} />
        </div>
      </PageBody>
    )
  }

  const threadChannelId = /^\/c\/([^/]+)\/t\//.exec(pathname)?.[1]

  return (
    <PageBody width="full" className="flex min-h-0 flex-1 flex-col p-0">
      <div className="flex items-center border-b px-2 py-1">
        <Button variant="ghost" size="sm" asChild className="min-h-11">
          {threadChannelId === undefined ? (
            <Link to="/chat">
              <ArrowLeft className="size-4" aria-hidden />
              {t`Back to chat`}
            </Link>
          ) : (
            <Link to="/c/$channelId" params={{ channelId: threadChannelId }}>
              <ArrowLeft className="size-4" aria-hidden />
              {t`Back to channel`}
            </Link>
          )}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </PageBody>
  )
}
