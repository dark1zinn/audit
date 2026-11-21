import { Trans } from "@lingui/react/macro"
import { TooltipProvider } from "@audit/ui/components/ui/tooltip.tsx"
import type { Me } from "@audit/domain/identity/schema"
import {
  readSidebarDefaultOpen,
  SidebarInset,
  SidebarProvider,
} from "@audit/ui/components/ui/sidebar.tsx"
import type { ReactNode } from "react"
import { AssistantPanel } from "./ai/assistant-panel.tsx"
import { AppHeader } from "./shell/app-header.tsx"
import { AppSidebar } from "./shell/app-sidebar.tsx"
import { MobileTabBar } from "./shell/mobile-tab-bar.tsx"
import { CommandPalette } from "./palette/command-palette.tsx"
import { ShortcutsHelp } from "./shortcuts-help.tsx"

/** Signed-in frame: collapsible sidebar, sticky header, content, and the mobile tab bar. */
export function AppShell({ me, children }: { readonly me: Me; readonly children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={readSidebarDefaultOpen()}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:ring-2 focus:ring-ring"
        >
          <Trans>Skip to content</Trans>
        </a>
        <AppSidebar me={me} />
        <SidebarInset className="min-w-0 h-svh max-h-svh min-h-0 overflow-hidden md:h-[calc(100svh-1rem)] md:max-h-[calc(100svh-1rem)]">
          <AppHeader />
          <main
            id="main"
            data-scroll-restoration-id="main"
            tabIndex={-1}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none md:px-6 md:pt-6 md:pb-6"
          >
            {children}
          </main>
          <MobileTabBar me={me} />
        </SidebarInset>
        <AssistantPanel />
        <CommandPalette />
        <ShortcutsHelp />
      </SidebarProvider>
    </TooltipProvider>
  )
}
