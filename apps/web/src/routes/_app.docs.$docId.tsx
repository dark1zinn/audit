import { createFileRoute } from "@tanstack/react-router"
import type { DocId } from "@audit/domain/ids"
import { DocsPage } from "../components/docs/docs-page.tsx"
import { docSearch } from "../components/docs/doc-search.ts"

export const Route = createFileRoute("/_app/docs/$docId")({
  validateSearch: docSearch,
  component: WorkspaceDocPage,
})

function WorkspaceDocPage() {
  const { docId } = Route.useParams()
  const { template } = Route.useSearch()
  return <DocsPage projectId={null} projectKey={null} docId={docId as DocId} template={template} />
}
