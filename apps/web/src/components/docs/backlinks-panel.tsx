import { Trans } from "@lingui/react/macro"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { EntityId } from "@audit/domain/ids"
import { ErrorMessage, LoadingRows } from "../feedback.tsx"
import { backlinksQuery } from "./queries.ts"

interface BacklinksPanelProps {
  readonly entityId: EntityId
  /** Project whose docs are shown; decides the route used for doc links. */
  readonly projectKey: string | null
}

/** Docs and tasks that link to this entity, grouped by source type. */
export const BacklinksPanel = ({ entityId, projectKey }: BacklinksPanelProps) => {
  const backlinks = useQuery(backlinksQuery(entityId))
  if (backlinks.isPending) return <LoadingRows />
  if (backlinks.isError) return <ErrorMessage error={backlinks.error} />
  const groups = backlinks.data
  if (groups.every((group) => group.items.length === 0)) {
    return (
      <p className="pt-3 text-sm text-muted-foreground">
        <Trans>Nothing links here yet.</Trans>
      </p>
    )
  }
  return (
    <div className="space-y-4 pt-3">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.type} className="space-y-2">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">{group.type}</h3>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={`${item.sourceId}-${item.kind}`} className="rounded-md border p-2 text-sm">
                  {item.sourceType !== "doc" ? (
                    <span className="font-medium">{item.sourceTitle}</span>
                  ) : projectKey === null ? (
                    <Link
                      to="/docs/$docId"
                      params={{ docId: item.sourceId }}
                      className="font-medium text-primary underline"
                    >
                      {item.sourceTitle}
                    </Link>
                  ) : (
                    <Link
                      to="/p/$key/docs/$docId"
                      params={{ key: projectKey, docId: item.sourceId }}
                      className="font-medium text-primary underline"
                    >
                      {item.sourceTitle}
                    </Link>
                  )}
                  {item.snippet !== "" && (
                    <p className="mt-1 text-xs text-muted-foreground">{item.snippet}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  )
}
