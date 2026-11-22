import type { DocId } from "@audit/domain/ids"
import { createFileRoute } from "@tanstack/react-router"
import { DocsWorkspace } from "../components/docs/docs-page.tsx"
import { docSearch } from "../components/docs/doc-search.ts"

export const Route = createFileRoute("/_app/docs/")({
  validateSearch: docSearch,
  component: WorkspaceDocsIndex,
})

function WorkspaceDocsIndex() {
  const { new: newRequest, split } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <DocsWorkspace
      projectId={null}
      projectKey={null}
      docId={null}
      split={split as DocId | undefined}
      onSplitChange={(next) => void navigate({ search: (prev) => ({ ...prev, split: next }) })}
      newRequest={newRequest}
    />
  )
}
