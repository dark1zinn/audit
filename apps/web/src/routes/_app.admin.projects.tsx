import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ProjectSummary } from "@audit/domain/projects/schema"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@audit/ui/components/ui/table.tsx"
import { EntityActionsButton } from "../components/actions/entity-menu.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { adminProjectsQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/projects")({
  staticData: { crumb: () => ({ label: tMacro`Projects` }) },
  component: AdminProjectsPage,
})

function AdminProjectsPage() {
  const { t } = useLingui()
  const projects = useQuery(adminProjectsQuery)

  return (
    <>
      <PageHeader
        title={t`Projects`}
        description={t`Every project in the workspace, including archived and deleted ones.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>All projects</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Restricted projects show metadata only. Deleted projects appear only here.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projects.isPending && <LoadingRows />}
          {projects.isError && <ErrorMessage error={projects.error} />}
          {projects.data !== undefined && <ProjectsTable projects={projects.data} />}
        </CardContent>
      </Card>
    </>
  )
}

function ProjectsTable({ projects }: { readonly projects: ReadonlyArray<ProjectSummary> }) {
  const { t } = useLingui()

  const statusLabel = (status: ProjectSummary["status"]) => {
    switch (status) {
      case "active":
        return t`Active`
      case "archived":
        return t`Archived`
      case "deleted":
        return t`Deleted`
    }
  }

  return (
    <Table className="max-sm:block">
      <TableHeader className="max-sm:hidden">
        <TableRow>
          <TableHead>
            <Trans>Key</Trans>
          </TableHead>
          <TableHead>
            <Trans>Name</Trans>
          </TableHead>
          <TableHead>
            <Trans>Status</Trans>
          </TableHead>
          <TableHead>
            <Trans>Visibility</Trans>
          </TableHead>
          <TableHead>
            <span className="sr-only">
              <Trans>Actions</Trans>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="max-sm:block">
        {projects.map((project) => (
          <TableRow key={project.id} className="max-sm:block max-sm:border-b max-sm:py-2">
            <TableCell className="font-mono max-sm:block max-sm:px-3 max-sm:pt-1">
              {project.key}
            </TableCell>
            <TableCell className="max-sm:block max-sm:whitespace-normal max-sm:px-3">
              <span className="flex flex-wrap items-center gap-2">
                {project.name}
                {project.metadataOnly && (
                  <Badge variant="outline">
                    <Trans>Metadata only</Trans>
                  </Badge>
                )}
              </span>
              <div className="text-xs text-muted-foreground sm:hidden">
                {statusLabel(project.status)} ·{" "}
                {project.visibility === "workspace" ? t`Workspace` : t`Restricted`}
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">{statusLabel(project.status)}</TableCell>
            <TableCell className="hidden sm:table-cell">
              {project.visibility === "workspace" ? (
                <Trans>Workspace</Trans>
              ) : (
                <Trans>Restricted</Trans>
              )}
            </TableCell>
            <TableCell className="text-end max-sm:block max-sm:px-3 max-sm:py-1">
              <div className="max-sm:[&_button]:size-11">
                <EntityActionsButton
                  target={{ kind: "project", project }}
                  label={t`Actions for project ${project.key}`}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
