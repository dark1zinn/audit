import { createFileRoute } from "@tanstack/react-router"
import type { DocId } from "@audit/domain/ids"
import { WithProject } from "../components/list/with-project.tsx"
import { DocsPage, docSearch } from "../components/docs/docs-page.tsx"

export const Route = createFileRoute("/_app/p/$key/docs/$docId")({
  validateSearch: docSearch,
  component: ProjectDocPage,
})

function ProjectDocPage() {
  const { key, docId } = Route.useParams()
  const { template } = Route.useSearch()
  return (
    <WithProject projectKey={key}>
      {(project) => (
        <DocsPage
          projectId={project.id}
          projectKey={key}
          docId={docId as DocId}
          template={template}
        />
      )}
    </WithProject>
  )
}
