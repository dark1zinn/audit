import { t } from "@lingui/core/macro"
import { useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ProjectId } from "@audit/domain/ids"
import type { ProjectDetail } from "@audit/domain/projects/schema"
import { AccessSection } from "../components/project-settings/access-section.tsx"
import { BoardsSection } from "../components/project-settings/boards-section.tsx"
import { GeneralSection } from "../components/project-settings/general-section.tsx"
import { LabelsSection } from "../components/project-settings/labels-section.tsx"
import { LifecycleSection } from "../components/project-settings/lifecycle-section.tsx"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { projectQuery, projectsQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/p/$key/settings")({
  staticData: { crumb: () => ({ label: t`Settings` }) },
  component: ProjectSettingsPage,
})

function ProjectSettingsPage() {
  const { t } = useLingui()
  const { key } = Route.useParams()
  const projects = useQuery(projectsQuery)

  if (projects.isPending) return <LoadingRows />
  if (projects.isError) return <ErrorMessage error={projects.error} />

  const summary = projects.data.find((project) => project.key === key)
  if (summary === undefined) {
    return <p className="text-sm text-muted-foreground">{t`Project not found.`}</p>
  }
  return <ProjectSettings projectId={summary.id} />
}

function ProjectSettings({ projectId }: { readonly projectId: ProjectId }) {
  const project = useQuery(projectQuery(projectId))

  if (project.isPending) return <LoadingRows />
  if (project.isError) return <ErrorMessage error={project.error} />

  return <ProjectSettingsSections project={project.data} />
}

function ProjectSettingsSections({ project }: { readonly project: ProjectDetail }) {
  return (
    <div className="space-y-6">
      {/* Keyed by version so local form state resets after every saved change. */}
      <GeneralSection key={`general:${project.version}`} project={project} />
      <AccessSection key={`access:${project.version}`} project={project} />
      <BoardsSection projectId={project.id} />
      <LabelsSection projectId={project.id} />
      <LifecycleSection key={`lifecycle:${project.version}`} project={project} />
    </div>
  )
}
