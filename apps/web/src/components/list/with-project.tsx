import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import type { ProjectSummary } from "@audit/domain/projects/schema"
import { projectsQuery } from "../../lib/queries.ts"

/** Resolves the project key in the URL to the caller's visible project, then renders children. */
export function WithProject({
  projectKey,
  children,
}: {
  readonly projectKey: string
  readonly children: (project: ProjectSummary) => ReactNode
}) {
  const projects = useQuery(projectsQuery)
  if (projects.isPending) return <LoadingRows />
  if (projects.isError) return <ErrorMessage error={projects.error} />
  const project = projects.data.find((summary) => summary.key === projectKey)
  if (project === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>Project not found.</Trans>
      </p>
    )
  }
  return children(project)
}
