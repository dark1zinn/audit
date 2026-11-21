import { type ReactNode, useMemo } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Schema } from "effect"
import type { Editor } from "@tiptap/react"
import { EntityId } from "@audit/domain/ids"
import { type Mention, extractMentions } from "@audit/editor/mentions"
import { EntityChip } from "../mentions/entity-chip.tsx"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { backlinksQuery } from "./queries.ts"
import { useEditorDoc } from "./outline-pane.tsx"

const SectionTitle = ({ children }: { readonly children: ReactNode }) => (
  <h3 className="text-xs font-medium uppercase text-muted-foreground">{children}</h3>
)

const OutgoingChip = ({ mention }: { readonly mention: Mention }) => {
  if (!Schema.is(EntityId)(mention.id)) return null
  return <EntityChip id={mention.id} type={mention.type} label={mention.snippet || mention.type} />
}

/** Docs and tasks that link to this doc, plus the mentions this doc makes. Each chip previews on hover. */
export const LinksPane = ({
  docId,
  editor,
}: {
  readonly docId: EntityId
  readonly editor: Editor | null
}) => {
  const { t } = useLingui()
  const backlinks = useQuery(backlinksQuery(docId))
  const json = useEditorDoc(editor)
  const outgoing = useMemo(() => (json === null ? [] : extractMentions(json)), [json])
  const linked = backlinks.data?.flatMap((group) => group.items) ?? []

  return (
    <div className="space-y-5 pt-3 text-sm">
      <section className="space-y-2" aria-label={t`Linked mentions`}>
        <SectionTitle>
          <Trans>Linked mentions</Trans>
        </SectionTitle>
        {backlinks.isPending ? (
          <LoadingRows />
        ) : backlinks.isError ? (
          <ErrorMessage error={backlinks.error} />
        ) : linked.length === 0 ? (
          <p className="text-muted-foreground">
            <Trans>Nothing links here yet.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col items-start gap-2">
            {linked.map((item) => (
              <li key={`${item.sourceId}-${item.kind}`} className="max-w-full">
                <EntityChip id={item.sourceId} type={item.sourceType} label={item.sourceTitle} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-label={t`Outgoing links`}>
        <SectionTitle>
          <Trans>Outgoing links</Trans>
        </SectionTitle>
        {outgoing.length === 0 ? (
          <p className="text-muted-foreground">
            <Trans>No outgoing links.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col items-start gap-2">
            {outgoing.map((mention, index) => (
              <li key={`${mention.id}-${index}`} className="max-w-full">
                <OutgoingChip mention={mention} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
