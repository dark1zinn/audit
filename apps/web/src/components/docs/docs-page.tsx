import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { DocId, EntityId, ProjectId } from "@audit/domain/ids"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { DocTree } from "./doc-tree.tsx"
import { DocView } from "./doc-view.tsx"
import { NewDocDialog } from "./new-doc-dialog.tsx"
import { docTreeQuery } from "./queries.ts"

interface DocsPageProps {
  /** `null` for the workspace space, otherwise the project whose docs are shown. */
  readonly projectId: ProjectId | null
  readonly projectKey: string | null
  readonly docId: DocId | null
  /** Template chosen when the doc was created; applied by the editor on first open. */
  readonly template?: string | undefined
  /** Id of a new-doc request from elsewhere (for example the command palette). */
  readonly newRequest?: string | undefined
}

/** Doc tree beside the selected doc. The same page serves the space and each project. */
export const DocsPage = ({ projectId, projectKey, docId, template, newRequest }: DocsPageProps) => {
  const { t } = useLingui()
  const tree = useQuery(docTreeQuery(projectId))
  const hrefFor = (id: DocId) =>
    projectKey === null ? `/docs/${id}` : `/p/${projectKey}/docs/${id}`
  const parentId: EntityId = projectId ?? WORKSPACE_SPACE_ID

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)] print:block">
      <aside aria-label={t`Documents`} className="min-w-0 space-y-3 print:hidden">
        <NewDocDialog parentId={parentId} hrefFor={hrefFor} requestId={newRequest} />
        {tree.isPending && <LoadingRows />}
        {tree.isError && <ErrorMessage error={tree.error} />}
        {tree.isSuccess && <DocTree docs={tree.data} activeDocId={docId} hrefFor={hrefFor} />}
      </aside>
      <section className="min-w-0">
        {docId === null ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Select a document to read or edit it.</Trans>
          </p>
        ) : (
          <DocView
            key={docId}
            docId={docId}
            projectId={projectId}
            projectKey={projectKey}
            template={template}
          />
        )}
      </section>
    </div>
  )
}
