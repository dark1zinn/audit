import { createFileRoute } from "@tanstack/react-router"
import { WithProject } from "../components/list/with-project.tsx"
import { DocsPage } from "../components/docs/docs-page.tsx"
import { docSearch } from "../components/docs/doc-search.ts"

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
