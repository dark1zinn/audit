import { Trans, useLingui } from "@lingui/react/macro"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Kbd } from "@audit/ui/components/ui/kbd.tsx"
import { SidebarTrigger } from "@audit/ui/components/ui/sidebar.tsx"
import { Search, Sparkles } from "lucide-react"
import { setAssistantOpen, useAssistantState } from "../ai/ai-store.ts"
import { openCommandPalette } from "../palette/palette-store.ts"
import { modKey } from "../../lib/platform.ts"
import { Breadcrumbs } from "./breadcrumbs.tsx"

/** Sticky top bar: sidebar toggle, breadcrumbs, search (⌘K) and the assistant. */
export function AppHeader() {
  const { t } = useLingui()
  const assistantOpen = useAssistantState().open
  const shortcut = modKey() === "⌘" ? "⌘K" : "Ctrl K"
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur md:px-4">
      <SidebarTrigger className="size-11 md:size-7" />
      <div className="flex min-w-0 flex-1 items-center">
        <Breadcrumbs />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="size-11 shrink-0 md:size-auto md:w-72 md:justify-between md:px-2.5"
        aria-label={`${t`Search or jump to…`} ${shortcut}`}
        onClick={() => openCommandPalette()}
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="hidden min-w-0 truncate text-muted-foreground md:inline">
          {t`Search or jump to…`}
        </span>
        <Kbd className="hidden md:inline-flex" aria-hidden="true">
          {shortcut}
        </Kbd>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 md:min-h-0"
        aria-haspopup="dialog"
        aria-expanded={assistantOpen}
        onClick={() => setAssistantOpen(!assistantOpen)}
      >
        <Sparkles aria-hidden="true" className="size-4" />
        <Trans>Assistant</Trans>
      </Button>
    </header>
  )
}
