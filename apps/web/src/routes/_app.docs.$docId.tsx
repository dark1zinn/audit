import { createFileRoute } from "@tanstack/react-router"
import type { DocId } from "@audit/domain/ids"
import { DocsPage, docSearch } from "../components/docs/docs-page.tsx"

export const Route = createFileRoute("/_app/docs/$docId")({
  validateSearch: docSearch,
  component: WorkspaceDocPage,
})

function WorkspaceDocPage() {
  const { docId } = Route.useParams()
  const { template } = Route.useSearch()
  return <DocsPage projectId={null} projectKey={null} docId={docId as DocId} template={template} />
}
