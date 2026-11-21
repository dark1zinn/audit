import { createFileRoute } from "@tanstack/react-router"
import type { DocId } from "@audit/domain/ids"
import { WithProject } from "../components/list/with-project.tsx"
import { DocsWorkspace } from "../components/docs/docs-page.tsx"
import { docSearch } from "../components/docs/doc-search.ts"

export const Route = createFileRoute("/_app/p/$key/docs/")({
  validateSearch: docSearch,
  component: ProjectDocsIndex,
})

function ProjectDocsIndex() {
  const { key } = Route.useParams()
  const { new: newRequest, split } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <WithProject projectKey={key}>
      {(project) => (
        <DocsWorkspace
          projectId={project.id}
          projectKey={key}
          docId={null}
          split={split as DocId | undefined}
          onSplitChange={(next) => void navigate({ search: (prev) => ({ ...prev, split: next }) })}
          newRequest={newRequest}
        />
      )}
    </WithProject>
  )
}
