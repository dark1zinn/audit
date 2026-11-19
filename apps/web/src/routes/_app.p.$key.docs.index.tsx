import { createFileRoute } from "@tanstack/react-router"
import { WithProject } from "../components/list/with-project.tsx"
import { DocsPage, docSearch } from "../components/docs/docs-page.tsx"

export const Route = createFileRoute("/_app/p/$key/docs/")({
  validateSearch: docSearch,
  component: ProjectDocsIndex,
})

function ProjectDocsIndex() {
  const { key } = Route.useParams()
  return (
    <WithProject projectKey={key}>
      {(project) => <DocsPage projectId={project.id} projectKey={key} docId={null} />}
    </WithProject>
  )
}
