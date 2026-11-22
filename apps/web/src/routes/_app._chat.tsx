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
import { useWideScreen } from "../components/chat/use-wide-screen.ts"
import { PageBody, PageHeader } from "../components/feedback.tsx"

const PANEL_KEY = "audit.chatPanel"
const PANEL_ID = "chat-panel"

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

  if (wide) {
    return (
      <PageBody width="full" className="flex h-[calc(100svh-4rem)] min-h-0 flex-col p-0">
        <ResizablePanelGroup
          id={PANEL_ID}
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={readPanelLayout()}
          onLayoutChanged={writePanelLayout}
        >
          <ResizablePanel
            id="chat-list"
            defaultSize="22%"
            minSize="16%"
            maxSize="35%"
            className="min-w-0"
          >
            <div className="h-full border-e">
              <ChatNav meId={me.userId} />
            </div>
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
      <PageBody width="full" className="flex flex-col gap-3 p-4">
        <PageHeader title={t`Chat`} />
        <ChatNav meId={me.userId} />
      </PageBody>
    )
  }

  return (
    <PageBody width="full" className="flex min-h-0 flex-col p-0">
      <div className="flex items-center border-b px-2 py-1">
        <Button variant="ghost" size="sm" asChild className="min-h-11">
          <Link to="/chat">
            <ArrowLeft className="size-4" aria-hidden />
            {t`Back to chat`}
          </Link>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </PageBody>
  )
}
