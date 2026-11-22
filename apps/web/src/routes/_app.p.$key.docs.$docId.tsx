import { createFileRoute } from "@tanstack/react-router"
import type { DocId } from "@audit/domain/ids"
import { WithProject } from "../components/list/with-project.tsx"
import { DocsWorkspace } from "../components/docs/docs-page.tsx"
import { docSearch } from "../components/docs/doc-search.ts"

export const Route = createFileRoute("/_app/p/$key/docs/$docId")({
  validateSearch: docSearch,
  component: ProjectDocPage,
})

function ProjectDocPage() {
  const { key, docId } = Route.useParams()
  const { template, split } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <WithProject projectKey={key}>
      {(project) => (
        <DocsWorkspace
          projectId={project.id}
          projectKey={key}
          docId={docId as DocId}
          template={template}
          split={split as DocId | undefined}
          onSplitChange={(next) => void navigate({ search: (prev) => ({ ...prev, split: next }) })}
        />
      )}
    </WithProject>
  )
}
