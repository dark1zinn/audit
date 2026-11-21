import { Trans, useLingui } from "@lingui/react/macro"
import { Link, useRouterState } from "@tanstack/react-router"
import { isWorkspaceAdmin } from "@audit/domain/roles"
import type { Me } from "@audit/domain/identity/schema"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@audit/ui/components/ui/drawer.tsx"
import { useTheme, type ThemeMode } from "@audit/ui/theme.tsx"
import {
  Calendar,
  CircleCheck,
  FileText,
  FolderKanban,
  Home,
  Inbox,
  LogOut,
  MessagesSquare,
  MoreHorizontal,
  type LucideIcon,
  Search,
  Settings,
  Shield,
} from "lucide-react"
import { useState } from "react"
import { useChatUnreadTotal } from "../chat/chat-nav.tsx"
import { useInboxUnreadCount } from "../inbox/nav-link.tsx"
import { LOCALE_NAMES, LOCALES, useChangeLocale } from "../../lib/locale.ts"
import { openCommandPalette } from "../palette/palette-store.ts"
import { isPathActive } from "./path.ts"
import { useSignOut } from "./shell-hooks.ts"

type Icon = LucideIcon

const TAB_CLASS =
  "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:text-foreground"

/** Fixed bottom navigation below `md`. Items past the first four live in the "More" drawer. */
export function MobileTabBar({ me }: { readonly me: Me }) {
  const { t } = useLingui()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const inboxUnread = useInboxUnreadCount()
  const chatUnread = useChatUnreadTotal()
  const [moreOpen, setMoreOpen] = useState(false)
  const admin = isWorkspaceAdmin(me.role)

  const tabs: ReadonlyArray<{
    to: string
    label: string
    icon: Icon
    badge: number
    exact?: boolean
  }> = [
    { to: "/", label: t`Home`, icon: Home, badge: 0, exact: true },
    { to: "/inbox", label: t`Inbox`, icon: Inbox, badge: inboxUnread },
    { to: "/chat", label: t`Chat`, icon: MessagesSquare, badge: chatUnread },
    { to: "/projects", label: t`Projects`, icon: FolderKanban, badge: 0 },
  ]

  return (
    <nav
      aria-label={t`Primary`}
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 px-1 pt-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((tab) => {
        const active = isPathActive(pathname, tab.to)
        return (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.exact === true }}
            className={TAB_CLASS}
            aria-current={active ? "page" : undefined}
            title={tab.label}
          >
            <span className="relative">
              <tab.icon aria-hidden="true" className="size-5" />
              {tab.badge > 0 && (
                <span className="absolute -end-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                  {tab.badge > 99 ? "99+" : tab.badge}
                </span>
              )}
            </span>
            <span className="max-w-full truncate text-[11px]">{tab.label}</span>
          </Link>
        )
      })}
      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerTrigger asChild>
          <button type="button" className={TAB_CLASS} aria-haspopup="dialog">
            <MoreHorizontal aria-hidden="true" className="size-5" />
            <span className="max-w-full truncate text-[11px]">{t`More`}</span>
          </button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="text-start">
            <DrawerTitle>
              <Trans>More</Trans>
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              <Trans>More places in the workspace</Trans>
            </DrawerDescription>
          </DrawerHeader>
          <MoreList me={me} admin={admin} onNavigate={() => setMoreOpen(false)} />
        </DrawerContent>
      </Drawer>
    </nav>
  )
}

const ROW_CLASS =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"

function MoreList({
  me,
  admin,
  onNavigate,
}: {
  readonly me: Me
  readonly admin: boolean
  readonly onNavigate: () => void
}) {
  const { t } = useLingui()
  const { theme, setTheme } = useTheme()
  const changeLocale = useChangeLocale(me)
  const signOut = useSignOut()
  const links: ReadonlyArray<{ to: string; label: string; icon: Icon }> = [
    { to: "/my-tasks", label: t`My tasks`, icon: CircleCheck },
    { to: "/docs", label: t`Docs`, icon: FileText },
    { to: "/calendar", label: t`Calendar`, icon: Calendar },
    { to: "/settings/profile", label: t`Settings`, icon: Settings },
    ...(admin ? [{ to: "/admin", label: t`Admin console`, icon: Shield }] : []),
  ]
  const themes: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: t`Light` },
    { value: "dark", label: t`Dark` },
    { value: "system", label: t`System` },
  ]

  return (
    <div className="max-h-[70vh] space-y-1 overflow-y-auto p-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => {
          onNavigate()
          openCommandPalette()
        }}
      >
        <Search aria-hidden="true" className="size-4" />
        <Trans>Search</Trans>
      </button>
      {links.map((link) => (
        <Link key={link.to} to={link.to} className={ROW_CLASS} onClick={onNavigate}>
          <link.icon aria-hidden="true" className="size-4" />
          {link.label}
        </Link>
      ))}
      <fieldset aria-label={t`Theme`} className="m-0 flex min-w-0 gap-1 border-0 p-0 px-1 pt-2">
        {themes.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={theme === option.value}
            className="min-h-11 flex-1 rounded-md border px-2 text-sm aria-pressed:bg-accent aria-pressed:font-medium focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
      <fieldset
        aria-label={t`Language`}
        className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0 px-1 pt-2"
      >
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            className="min-h-11 flex-1 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => changeLocale.mutate(locale)}
          >
            {LOCALE_NAMES[locale]}
          </button>
        ))}
      </fieldset>
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => {
          onNavigate()
          void signOut()
        }}
      >
        <LogOut aria-hidden="true" className="size-4" />
        <Trans>Sign out</Trans>
      </button>
    </div>
  )
}
