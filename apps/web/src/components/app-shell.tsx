import { Trans, useLingui } from "@lingui/react/macro"
import { Link, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { isWorkspaceAdmin } from "@audit/domain/roles"
import { Avatar, AvatarFallback } from "@audit/ui/components/ui/avatar.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@audit/ui/components/ui/dropdown-menu.tsx"
import { Separator } from "@audit/ui/components/ui/separator.tsx"
import { useTheme, type Density, type ThemeMode } from "@audit/ui/theme.tsx"
import { useState, type ReactNode } from "react"
import { authClient } from "../lib/auth.ts"
import type { Me } from "@audit/domain/identity/schema"
import { projectsQuery } from "../lib/queries.ts"
import { ErrorMessage } from "./feedback.tsx"
import { ProjectCreateDialog } from "./project-create-dialog.tsx"

const navLinkClass =
  "flex items-center rounded-md px-3 py-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"

function NavLink({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return (
    <Link
      to={to}
      className={navLinkClass}
      activeProps={{ className: `${navLinkClass} bg-accent text-foreground` }}
    >
      {children}
    </Link>
  )
}

function ProjectsNav() {
  const { t } = useLingui()
  const projects = useQuery(projectsQuery)
  const [creating, setCreating] = useState(false)

  return (
    <>
      <Separator className="my-2" />
      <span className="px-3 py-1 text-xs font-medium uppercase text-muted-foreground">
        <Trans>Projects</Trans>
      </span>
      <nav aria-label={t`Projects`} className="flex flex-col gap-1">
        {projects.data?.map((project) => (
          <Link
            key={project.id}
            to="/p/$key/board"
            params={{ key: project.key }}
            className={navLinkClass}
            activeProps={{ className: `${navLinkClass} bg-accent text-foreground` }}
          >
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
              {project.key}
            </span>
            <span className="truncate">{project.name}</span>
          </Link>
        ))}
      </nav>
      {projects.isError && <ErrorMessage error={projects.error} />}
      <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setCreating(true)}>
        <Trans>New project</Trans>
      </Button>
      <ProjectCreateDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function UserMenu({ me }: { readonly me: Me }) {
  const { t } = useLingui()
  const { theme, setTheme, density, setDensity } = useTheme()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const signOut = async () => {
    await authClient.signOut()
    queryClient.removeQueries()
    await navigate({ to: "/login" })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t`Account menu`}>
          <Avatar className="size-7">
            <AvatarFallback>{initials(me.displayName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block font-medium">{me.displayName}</span>
          <span className="block text-xs font-normal text-muted-foreground">{me.email}</span>
        </DropdownMenuLabel>
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
        <DropdownMenuItem onClick={() => void signOut()}>
          <Trans>Sign out</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell({ me, children }: { readonly me: Me; readonly children: ReactNode }) {
  const { t } = useLingui()
  const admin = isWorkspaceAdmin(me.role)

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <div className="pb-4 text-lg font-semibold">{me.workspace.name}</div>
        <nav aria-label={t`Main`} className="flex flex-col gap-1">
          <NavLink to="/">
            <Trans>Home</Trans>
          </NavLink>
          <NavLink to="/settings/profile">
            <Trans>Profile</Trans>
          </NavLink>
          <NavLink to="/settings/security">
            <Trans>Security</Trans>
          </NavLink>
          {admin && (
            <>
              <Separator className="my-2" />
              <span className="px-3 py-1 text-xs font-medium uppercase text-muted-foreground">
                <Trans>Admin</Trans>
              </span>
              <NavLink to="/admin/projects">
                <Trans>Projects</Trans>
              </NavLink>
              <NavLink to="/admin/members">
                <Trans>Members</Trans>
              </NavLink>
              <NavLink to="/admin/invites">
                <Trans>Invites</Trans>
              </NavLink>
              <NavLink to="/admin/teams">
                <Trans>Teams</Trans>
              </NavLink>
              <NavLink to="/admin/audit">
                <Trans>Audit log</Trans>
              </NavLink>
              <NavLink to="/admin/workspace">
                <Trans>Workspace settings</Trans>
              </NavLink>
            </>
          )}
        </nav>
        <ProjectsNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-2 md:px-6">
          <span className="font-medium md:hidden">{me.workspace.name}</span>
          <div className="ml-auto">
            <UserMenu me={me} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
