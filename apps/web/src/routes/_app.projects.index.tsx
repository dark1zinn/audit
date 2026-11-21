import { t as tMacro } from "@lingui/core/macro"
import { Plural, Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { FolderKanban, Plus } from "lucide-react"
import { useState } from "react"
import type { ProjectSummary } from "@audit/domain/projects/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@audit/ui/components/ui/empty.tsx"
import { EntityActionsButton, EntityContextMenu } from "../components/actions/entity-menu.tsx"
import { ErrorMessage, LoadingRows, PageBody, PageHeader } from "../components/feedback.tsx"
import { ProjectCreateDialog } from "../components/project-create-dialog.tsx"
import { projectQuery, projectsQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/projects/")({
  validateSearch: (search: Record<string, unknown>): { new?: "1" } =>
    search.new === "1" ? { new: "1" } : {},
  staticData: { crumb: () => ({ label: tMacro`Projects` }) },
  component: ProjectsPage,
})

function ProjectsPage() {
  const { t } = useLingui()
  const { new: newRequest } = Route.useSearch()
  const projects = useQuery(projectsQuery)
  const [showArchived, setShowArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(newRequest === "1")

  if (projects.isPending) return <LoadingRows />
  if (projects.isError) return <ErrorMessage error={projects.error} />

  const visible = projects.data
    .filter((project) => project.status !== "deleted")
    .filter((project) => showArchived || project.status !== "archived")

  return (
    <PageBody width="wide" className="gap-6">
      <PageHeader
        title={t`Projects`}
        description={t`Every project you can see in this workspace.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? <Trans>Hide archived</Trans> : <Trans>Show archived</Trans>}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              <Trans>New project</Trans>
            </Button>
          </div>
        }
      />
      {visible.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanban aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <Trans>No projects yet</Trans>
            </EmptyTitle>
            <EmptyDescription>
              <Trans>Create a project to start tracking tasks, docs and events together.</Trans>
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>
              <Trans>New project</Trans>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
      <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageBody>
  )
}

function ProjectCard({ project }: { readonly project: ProjectSummary }) {
  const { t } = useLingui()
  const detail = useQuery(projectQuery(project.id))
  const archived = project.status === "archived"
  return (
    <EntityContextMenu target={{ kind: "project", project }}>
      <div className="group relative">
        <Card className="h-full transition-colors group-hover:bg-accent/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {project.key}
              </Badge>
              {archived && (
                <Badge variant="secondary">
                  <Trans>Archived</Trans>
                </Badge>
              )}
            </div>
            <CardTitle className="min-w-0 truncate pe-10 text-base" title={project.name}>
              <Link
                to="/p/$key/board"
                params={{ key: project.key }}
                className="rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {project.name}
              </Link>
            </CardTitle>
            <CardDescription>
              {detail.data === undefined ? (
                <span className="text-muted-foreground">
                  <Trans>Loading…</Trans>
                </span>
              ) : (
                <Plural value={detail.data.openTaskCount} one="# open task" other="# open tasks" />
              )}
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
        <div className="absolute end-2 top-2 z-10">
          <EntityActionsButton target={{ kind: "project", project }} label={t`Project actions`} />
        </div>
      </div>
    </EntityContextMenu>
  )
}
