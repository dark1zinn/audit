import { createFileRoute } from "@tanstack/react-router"
import { DocsPage, docSearch } from "../components/docs/docs-page.tsx"

export const Route = createFileRoute("/_app/docs/")({
  validateSearch: docSearch,
  component: WorkspaceDocsIndex,
})

function WorkspaceDocsIndex() {
  return <DocsPage projectId={null} projectKey={null} docId={null} />
}
