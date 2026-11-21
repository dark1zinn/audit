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
    <Table>
      <TableHeader>
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
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="font-mono">{project.key}</TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2">
                {project.name}
                {project.metadataOnly && (
                  <Badge variant="outline">
                    <Trans>Metadata only</Trans>
                  </Badge>
                )}
              </span>
            </TableCell>
            <TableCell>{statusLabel(project.status)}</TableCell>
            <TableCell>
              {project.visibility === "workspace" ? (
                <Trans>Workspace</Trans>
              ) : (
                <Trans>Restricted</Trans>
              )}
            </TableCell>
            <TableCell className="text-end">
              <EntityActionsButton
                target={{ kind: "project", project }}
                label={t`Actions for project ${project.key}`}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
