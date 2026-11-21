import { Plural, Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import type { ProjectId } from "@audit/domain/ids"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { EntityActionsButton } from "../components/actions/entity-menu.tsx"
import { ErrorMessage, LoadingRows, PageBody } from "../components/feedback.tsx"
import { projectQuery, projectsQuery } from "../lib/queries.ts"
import { useRealtimeScopes } from "../lib/realtime.ts"

export const Route = createFileRoute("/_app/p/$key")({
  staticData: {
    crumb: ({ params, projects }) => {
      const key = params["key"] ?? ""
      const project = projects?.find((candidate) => candidate.key === key)
      return {
        label: project === undefined ? key : `${key} ${project.name}`,
        to: `/p/${key}/board`,
      }
    },
  },
  component: ProjectLayout,
})

/** GitHub-style underline tab. The active tab is marked with `aria-current` and a primary underline. */
const tabClass =
  "flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-3 text-sm text-muted-foreground whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground md:min-h-9"

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
    <PageBody width="full" className="flex min-h-0 flex-1 flex-col gap-0">
      <header className="flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="font-mono">
              {project.key}
            </Badge>
            <h1
              className="min-w-0 truncate text-2xl font-semibold tracking-tight"
              title={project.name}
            >
              {project.name}
            </h1>
            {project.status === "archived" && (
              <Badge variant="secondary">
                <Trans>Archived</Trans>
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            <Plural value={project.openTaskCount} one="# open task" other="# open tasks" />
          </p>
        </div>
        <EntityActionsButton target={{ kind: "project", project }} label={t`Project actions`} />
      </header>
      <nav
        aria-label={t`Project views`}
        className="-mx-4 mb-6 flex overflow-x-auto border-b px-4 md:mx-0 md:px-0"
      >
        <Link
          to="/p/$key/board"
          params={{ key }}
          className={tabClass}
          activeProps={{ "aria-current": "page" }}
        >
          <Trans>Board</Trans>
        </Link>
        <Link
          to="/p/$key/list"
          params={{ key }}
          className={tabClass}
          activeProps={{ "aria-current": "page" }}
        >
          <Trans>List</Trans>
        </Link>
        <Link
          to="/p/$key/calendar"
          params={{ key }}
          className={tabClass}
          activeProps={{ "aria-current": "page" }}
        >
          <Trans>Calendar</Trans>
        </Link>
        <Link
          to="/p/$key/docs"
          params={{ key }}
          className={tabClass}
          activeProps={{ "aria-current": "page" }}
        >
          <Trans>Docs</Trans>
        </Link>
        {project.myRole === "manager" && (
          <Link
            to="/p/$key/settings"
            params={{ key }}
            className={tabClass}
            activeProps={{ "aria-current": "page" }}
          >
            <Trans>Settings</Trans>
          </Link>
        )}
      </nav>
      <Outlet />
    </PageBody>
  )
}
