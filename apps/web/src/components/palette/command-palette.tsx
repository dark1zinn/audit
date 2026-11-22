import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Command,
} from "@audit/ui/components/ui/command.tsx"
import { useTheme, type ThemeMode } from "@audit/ui/theme.tsx"
import { useSidebar } from "@audit/ui/components/ui/sidebar.tsx"
import { isWorkspaceAdmin } from "@audit/domain/roles"
import { modKey } from "../../lib/platform.ts"
import { useMe } from "../use-me.ts"
import { LOCALE_NAMES, LOCALES, useChangeLocale } from "../../lib/locale.ts"
import { projectsQuery } from "../../lib/queries.ts"
import { quickFindQuery } from "../../lib/search.ts"
import {
  setCommandPaletteOpen,
  toggleCommandPalette,
  useCommandPaletteOpen,
} from "./palette-store.ts"

const THEMES: ReadonlyArray<ThemeMode> = ["light", "dark", "system"]

/** Project key from a `/p/<key>/…` path, if the user is inside a project. */
const projectKeyFromPath = (pathname: string): string | undefined =>
  /^\/p\/([^/]+)/.exec(pathname)?.[1]

/**
 * Global command palette, opened with Ctrl/⌘K or `openCommandPalette()`. Quick find lists recent
 * items when the query is empty and matching items otherwise; actions navigate or change preferences.
 */
export function CommandPalette() {
  const { t } = useLingui()
  const open = useCommandPaletteOpen()
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const me = useMe()
  const { setTheme } = useTheme()
  const projects = useQuery(projectsQuery)
  const hits = useQuery({ ...quickFindQuery(query.trim()), enabled: open })
  const changeLocale = useChangeLocale(me)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        toggleCommandPalette()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const onOpenChange = (next: boolean) => {
    setCommandPaletteOpen(next)
    if (!next) setQuery("")
  }

  /** Closes the palette before running the chosen action so focus returns to the page. */
  const choose = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  const currentProjectKey = projectKeyFromPath(pathname) ?? projects.data?.[0]?.key
  const themeLabels: Record<ThemeMode, string> = {
    light: t`Light theme`,
    dark: t`Dark theme`,
    system: t`System theme`,
  }
  const emptyQuery = query.trim() === ""

  const admin = isWorkspaceAdmin(me.role)
  const { toggleSidebar } = useSidebar()
  const navItems: ReadonlyArray<{ to: string; label: string; admin?: boolean }> = [
    { to: "/", label: t`Home` },
    { to: "/inbox", label: t`Inbox` },
    { to: "/my-tasks", label: t`My tasks` },
    { to: "/chat", label: t`Chat` },
    { to: "/docs", label: t`Docs` },
    { to: "/calendar", label: t`Calendar` },
    { to: "/projects", label: t`Projects` },
    { to: "/settings/profile", label: t`Settings` },
    { to: "/admin", label: t`Admin console`, admin: true },
  ]
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t`Command palette`}>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t`Search or run a command…`}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{t`No matches.`}</CommandEmpty>
          <CommandGroup heading={emptyQuery ? t`Recent` : t`Results`}>
            {(hits.data ?? []).map((hit) => (
              <CommandItem
                key={hit.entityId}
                value={`hit-${hit.entityId}`}
                onSelect={() => choose(() => void router.history.push(hit.url))}
              >
                <span className="truncate">{hit.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t`Navigate`}>
            {navItems
              .filter((item) => item.admin !== true || admin)
              .map((item) => (
                <CommandItem
                  key={item.to}
                  value={`nav-${item.to}`}
                  onSelect={() => choose(() => void navigate({ to: item.to }))}
                >
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandGroup heading={t`Actions`}>
            <CommandItem
              value="action-create-task"
              disabled={currentProjectKey === undefined}
              onSelect={() =>
                choose(() => {
                  if (currentProjectKey === undefined) return
                  void navigate({
                    to: "/p/$key/board",
                    params: { key: currentProjectKey },
                    search: { new: "task" },
                  })
                })
              }
            >
              {t`Create task`}
            </CommandItem>
            <CommandItem
              value="action-new-doc"
              onSelect={() => choose(() => void navigate({ to: "/docs", search: { new: "1" } }))}
            >
              {t`New doc`}
            </CommandItem>
            <CommandItem
              value="action-new-event"
              onSelect={() =>
                choose(() => void navigate({ to: "/calendar", search: { new: "1" } }))
              }
            >
              {t`New event`}
            </CommandItem>
            <CommandItem
              value="action-new-project"
              onSelect={() =>
                choose(() => void navigate({ to: "/projects", search: { new: "1" } }))
              }
            >
              {t`New project`}
            </CommandItem>
            <CommandItem
              value="action-my-tasks"
              onSelect={() => choose(() => void navigate({ to: "/my-tasks" }))}
            >
              {t`Go to My tasks`}
            </CommandItem>
            <CommandItem
              value="action-inbox"
              onSelect={() => choose(() => void navigate({ to: "/inbox" }))}
            >
              {t`Inbox`}
            </CommandItem>
            <CommandItem
              value="action-toggle-sidebar"
              onSelect={() => choose(() => toggleSidebar())}
            >
              {t`Toggle sidebar`}
              <CommandShortcut>{modKey()}+\</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t`Switch theme`}>
            {THEMES.map((mode) => (
              <CommandItem
                key={mode}
                value={`theme-${mode}`}
                onSelect={() => choose(() => setTheme(mode))}
              >
                {themeLabels[mode]}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t`Switch language`}>
            {LOCALES.map((locale) => (
              <CommandItem
                key={locale}
                value={`locale-${locale}`}
                onSelect={() => choose(() => changeLocale.mutate(locale))}
              >
                {LOCALE_NAMES[locale]}
                <CommandShortcut>{locale}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
