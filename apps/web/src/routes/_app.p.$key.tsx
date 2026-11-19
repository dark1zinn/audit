import { Plural, Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import type { ProjectId } from "@audit/domain/ids"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { projectQuery, projectsQuery } from "../lib/queries.ts"
import { useRealtimeScopes } from "../lib/realtime.ts"

export const Route = createFileRoute("/_app/p/$key")({
  component: ProjectLayout,
})

const tabClass =
  "rounded-md px-3 py-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
const activeTabClass = `${tabClass} bg-accent font-medium text-foreground`

/** Resolves the key in the URL to a project id via the caller's visible projects. */
function ProjectLayout() {
  const { key } = Route.useParams()
  useRealtimeScopes([`project:${key}`])
  const projects = useQuery(projectsQuery)

  if (projects.isPending) return <LoadingRows />
  if (projects.isError) return <ErrorMessage error={projects.error} />

  const summary = projects.data.find((project) => project.key === key)
  if (summary === undefined) return <ProjectNotFound />
  return <ProjectHeader projectId={summary.id} />
}

function ProjectNotFound() {
  return (
    <p role="alert" className="text-sm text-muted-foreground">
      <Trans>This project does not exist or you cannot see it.</Trans>
    </p>
  )
}

function ProjectHeader({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useLingui()
  const { key } = Route.useParams()
  const detail = useQuery(projectQuery(projectId))

  if (detail.isPending) return <LoadingRows />
  if (detail.isError) return <ErrorMessage error={detail.error} />

  const project = detail.data
  return (
    <>
      <header className="space-y-2 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="font-mono">
            {project.key}
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {project.status === "archived" && (
            <Badge variant="secondary">
              <Trans>Archived</Trans>
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          <Plural value={project.openTaskCount} one="# open task" other="# open tasks" />
        </p>
      </header>
      <nav aria-label={t`Project views`} className="mb-6 flex gap-1 border-b">
        <Link
          to="/p/$key/board"
          params={{ key }}
          className={tabClass}
          activeProps={{ className: activeTabClass, "aria-current": "page" }}
        >
          <Trans>Board</Trans>
        </Link>
        <Link
          to="/p/$key/list"
          params={{ key }}
          className={tabClass}
          activeProps={{ className: activeTabClass, "aria-current": "page" }}
        >
          <Trans>List</Trans>
        </Link>
        <Link
          to="/p/$key/calendar"
          params={{ key }}
          className={tabClass}
          activeProps={{ className: activeTabClass, "aria-current": "page" }}
        >
          <Trans>Calendar</Trans>
        </Link>
        <Link
          to="/p/$key/docs"
          params={{ key }}
          className={tabClass}
          activeProps={{ className: activeTabClass, "aria-current": "page" }}
        >
          <Trans>Docs</Trans>
        </Link>
        <Link
          to="/p/$key/settings"
          params={{ key }}
          className={tabClass}
          activeProps={{ className: activeTabClass, "aria-current": "page" }}
        >
          <Trans>Settings</Trans>
        </Link>
      </nav>
      <Outlet />
    </>
  )
}
