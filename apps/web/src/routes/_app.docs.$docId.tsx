import { createFileRoute } from "@tanstack/react-router"
import type { DocId } from "@audit/domain/ids"
import { DocsWorkspace } from "../components/docs/docs-page.tsx"
import { docSearch } from "../components/docs/doc-search.ts"

export const Route = createFileRoute("/_app/docs/$docId")({
  validateSearch: docSearch,
  component: WorkspaceDocPage,
})

function WorkspaceDocPage() {
  const { docId } = Route.useParams()
  const { template, split } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <DocsWorkspace
      projectId={null}
      projectKey={null}
      docId={docId as DocId}
      template={template}
      split={split as DocId | undefined}
      onSplitChange={(next) => void navigate({ search: (prev) => ({ ...prev, split: next }) })}
    />
  )
}
