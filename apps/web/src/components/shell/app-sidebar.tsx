import { useLingui, Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouterState } from "@tanstack/react-router"
import type { Me } from "@audit/domain/identity/schema"
import { isWorkspaceAdmin } from "@audit/domain/roles"
import { Avatar, AvatarFallback } from "@audit/ui/components/ui/avatar.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@audit/ui/components/ui/sidebar.tsx"
import { useTheme, type Density, type ThemeMode } from "@audit/ui/theme.tsx"
import {
  Building2,
  Calendar,
  ChevronsUpDown,
  CircleCheck,
  FileText,
  FolderKanban,
  Home,
  Inbox,
  Keyboard,
  LogOut,
  MessagesSquare,
  Plus,
  Settings,
  Shield,
  UserPlus,
  User,
} from "lucide-react"
import { useState } from "react"
import { useChatUnreadTotal } from "../chat/chat-nav.tsx"
import { EntityActionsButton, EntityContextMenu } from "../actions/entity-menu.tsx"
import { ProjectCreateDialog } from "../project-create-dialog.tsx"
import { useInboxUnreadCount } from "../inbox/nav-link.tsx"
import { openShortcutsHelp } from "../shortcuts-store.ts"
import { LOCALE_NAMES, LOCALES, useChangeLocale } from "../../lib/locale.ts"
import { projectsQuery } from "../../lib/queries.ts"
import { initials, isPathActive } from "./path.ts"
import { useSignOut } from "./shell-hooks.ts"

/** Projects shown before the "View all projects" entry takes over. */
const SIDEBAR_PROJECT_LIMIT = 8

function WorkspaceMenu({ me }: { readonly me: Me }) {
  const { t } = useLingui()
  const admin = isWorkspaceAdmin(me.role)
  const workspaceName = me.workspace.name
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={workspaceName}>
              <span className="flex aspect-square size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                {initials(workspaceName)}
              </span>
              <span className="grid min-w-0 flex-1 text-start leading-tight">
                <span className="truncate font-medium">{workspaceName}</span>
              </span>
              <ChevronsUpDown aria-hidden="true" className="ms-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-56">
            {admin && (
              <DropdownMenuItem asChild>
                <Link to="/admin/invites">
                  <UserPlus aria-hidden="true" />
                  <Trans>Invite people</Trans>
                </Link>
              </DropdownMenuItem>
            )}
            {admin && (
              <DropdownMenuItem asChild>
                <Link to="/admin">
                  <Shield aria-hidden="true" />
                  <Trans>Admin console</Trans>
                </Link>
              </DropdownMenuItem>
            )}
            {admin && (
              <DropdownMenuItem asChild>
                <Link to="/admin/workspace">
                  <Building2 aria-hidden="true" />
                  <Trans>Workspace settings</Trans>
                </Link>
              </DropdownMenuItem>
            )}
            {admin && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={openShortcutsHelp}>
              <Keyboard aria-hidden="true" />
              {t`Keyboard shortcuts`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function MainNav() {
  const { t } = useLingui()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const inboxUnread = useInboxUnreadCount()
  const chatUnread = useChatUnreadTotal()
  const items = [
    { to: "/", label: t`Home`, icon: Home, badge: 0 },
    { to: "/inbox", label: t`Inbox`, icon: Inbox, badge: inboxUnread },
    { to: "/my-tasks", label: t`My tasks`, icon: CircleCheck, badge: 0 },
    { to: "/chat", label: t`Chat`, icon: MessagesSquare, badge: chatUnread },
    { to: "/docs", label: t`Docs`, icon: FileText, badge: 0 },
    { to: "/calendar", label: t`Calendar`, icon: Calendar, badge: 0 },
  ] as const

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <Trans>Main</Trans>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                asChild
                tooltip={item.label}
                isActive={isPathActive(pathname, item.to)}
              >
                <Link to={item.to}>
                  <item.icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
              {item.badge > 0 && (
                <SidebarMenuBadge>{item.badge > 99 ? "99+" : item.badge}</SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function ProjectsNav() {
  const { t } = useLingui()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const projects = useQuery(projectsQuery)
  const [createOpen, setCreateOpen] = useState(false)

  const active = (projects.data ?? []).filter((project) => project.status === "active")
  const shown = active.slice(0, SIDEBAR_PROJECT_LIMIT)
  const overflow = active.length > SIDEBAR_PROJECT_LIMIT

  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <Trans>Projects</Trans>
      </SidebarGroupLabel>
      <SidebarGroupAction
        aria-label={t`New project`}
        title={t`New project`}
        onClick={() => setCreateOpen(true)}
      >
        <Plus aria-hidden="true" />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          {shown.map((project) => (
            <SidebarMenuItem key={project.id}>
              <EntityContextMenu target={{ kind: "project", project }}>
                <SidebarMenuButton
                  asChild
                  tooltip={project.name}
                  className="pe-8 max-md:pe-12"
                  isActive={pathname.startsWith(`/p/${project.key}/`)}
                >
                  <Link to="/p/$key/board" params={{ key: project.key }}>
                    <span className="flex aspect-square size-5 shrink-0 items-center justify-center rounded bg-sidebar-accent font-mono text-[10px] font-semibold">
                      {project.key.slice(0, 3)}
                    </span>
                    <span className="truncate">{project.name}</span>
                  </Link>
                </SidebarMenuButton>
              </EntityContextMenu>
              <div className="absolute inset-y-0 end-1 flex items-center opacity-0 transition-opacity group-hover/menu-item:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 group-data-[collapsible=icon]:hidden">
                <EntityActionsButton
                  target={{ kind: "project", project }}
                  label={t`Actions for ${project.name}`}
                  size="icon-sm"
                />
              </div>
            </SidebarMenuItem>
          ))}
          {overflow && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip={t`View all projects`}>
                <Link to="/projects">
                  <FolderKanban aria-hidden="true" />
                  <span>
                    <Trans>View all projects</Trans>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
      <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </SidebarGroup>
  )
}

function AccountMenu({ me }: { readonly me: Me }) {
  const { theme, setTheme, density, setDensity } = useTheme()
  const changeLocale = useChangeLocale(me)
  const signOut = useSignOut()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={me.displayName}>
              <Avatar className="size-7 shrink-0" aria-hidden="true">
                <AvatarFallback>{initials(me.displayName)}</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-start leading-tight">
                <span className="truncate font-medium">{me.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{me.email}</span>
              </span>
              <ChevronsUpDown aria-hidden="true" className="ms-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-64">
            <DropdownMenuItem asChild>
              <Link to="/settings/profile">
                <User aria-hidden="true" />
                <Trans>Profile</Trans>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings/notifications">
                <Settings aria-hidden="true" />
                <Trans>Settings</Trans>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <Trans>Theme</Trans>
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as ThemeMode)}
            >
              <DropdownMenuRadioItem value="light">
                <Trans>Light</Trans>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Trans>Dark</Trans>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Trans>System</Trans>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <Trans>Density</Trans>
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={density}
              onValueChange={(value) => setDensity(value as Density)}
            >
              <DropdownMenuRadioItem value="comfortable">
                <Trans>Comfortable</Trans>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">
                <Trans>Compact</Trans>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>Language</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={me.locale ?? ""}
                  onValueChange={(value) => {
                    const locale = LOCALES.find((candidate) => candidate === value)
                    if (locale !== undefined) changeLocale.mutate(locale)
                  }}
                >
                  {LOCALES.map((locale) => (
                    <DropdownMenuRadioItem key={locale} value={locale}>
                      {LOCALE_NAMES[locale]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut aria-hidden="true" />
              <Trans>Sign out</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** Primary app navigation. Collapses to icons with `Ctrl/⌘ \`; on mobile it opens as a sheet. */
export function AppSidebar({ me }: { readonly me: Me }) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <WorkspaceMenu me={me} />
      </SidebarHeader>
      <SidebarContent>
        <MainNav />
        <ProjectsNav />
      </SidebarContent>
      <SidebarFooter>
        <AccountMenu me={me} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
