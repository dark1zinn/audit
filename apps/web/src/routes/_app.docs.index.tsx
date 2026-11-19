import { createFileRoute } from "@tanstack/react-router"
import { DocsPage } from "../components/docs/docs-page.tsx"
import { docSearch } from "../components/docs/doc-search.ts"

export const Route = createFileRoute("/_app/docs/")({
  validateSearch: docSearch,
  component: WorkspaceDocsIndex,
})

function WorkspaceDocsIndex() {
  const { new: newRequest } = Route.useSearch()
  return <DocsPage projectId={null} projectKey={null} docId={null} newRequest={newRequest} />
}
