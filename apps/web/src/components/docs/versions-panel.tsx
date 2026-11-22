import { useState } from "react"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { History } from "lucide-react"
import type { DocVersion } from "@audit/domain/docs/schema"
import type { DocId, DocVersionId } from "@audit/domain/ids"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { callApi } from "../../lib/api.ts"
import { EmptyState, ErrorMessage, LoadingRows } from "../feedback.tsx"
import { diffLines, contentLines } from "./diff.ts"
import { invalidateDoc, versionQuery, versionsQuery } from "./queries.ts"

interface VersionsPanelProps {
  readonly docId: DocId
  readonly canWrite: boolean
}

/** Snapshots of the doc: name one, compare a version with the one before it, or restore it. */
export const VersionsPanel = ({ docId, canWrite }: VersionsPanelProps) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const versions = useQuery(versionsQuery(docId))
  const [label, setLabel] = useState("")
  const [selected, setSelected] = useState<DocVersion | null>(null)
  const [error, setError] = useState<unknown>(null)

  const create = useMutation({
    mutationFn: () =>
      callApi((api) => api.docs.createVersion({ params: { docId }, payload: { label } })),
    onSuccess: () => {
      setLabel("")
      setError(null)
      void queryClient.invalidateQueries({ queryKey: versionsQuery(docId).queryKey })
    },
    onError: setError,
  })

  const restore = useMutation({
    mutationFn: (versionId: DocVersionId) =>
      callApi((api) => api.docs.restoreVersion({ params: { docId, versionId } })),
    onSuccess: () => {
      setError(null)
      setSelected(null)
      void invalidateDoc(queryClient, docId)
    },
    onError: setError,
  })

  const list = versions.data ?? []
  const older = selected === null ? undefined : list.find((v) => v.version === selected.version - 1)
  const selectedContent = useQuery({
    ...versionQuery(docId, selected?.id ?? (list[0]?.id as DocVersionId)),
    enabled: selected !== null,
  })
  const olderContent = useQuery({
    ...versionQuery(docId, older?.id ?? (list[0]?.id as DocVersionId)),
    enabled: older !== undefined,
  })

  if (versions.isPending) return <LoadingRows />
  if (versions.isError) return <ErrorMessage error={versions.error} />

  const diff =
    selected !== null && selectedContent.data !== undefined
      ? diffLines(
          older === undefined ? [] : contentLines(olderContent.data?.content),
          contentLines(selectedContent.data.content),
        )
      : null

  return (
    <div className="space-y-4 pt-3">
      {error !== null && <ErrorMessage error={error} />}
      {canWrite && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (label.trim() !== "") create.mutate()
            }}
          >
            <Input
              aria-label={t`Version name`}
              value={label}
              maxLength={120}
              placeholder={t`Name this version`}
              onChange={(event) => setLabel(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={create.isPending || label.trim() === ""}>
              <Trans>Save version</Trans>
            </Button>
          </form>
          {label.trim() === "" && (
            <p className="text-xs text-muted-foreground">
              <Trans>Enter a name to enable Save version.</Trans>
            </p>
          )}
        </>
      )}
      {list.length === 0 && (
        <EmptyState
          icon={History}
          title={t`No versions yet.`}
          description={t`Save a named version to keep a snapshot of this doc.`}
        />
      )}
      <ul className="space-y-2">
        {list.map((version) => (
          <li key={version.id}>
            <button
              type="button"
              aria-pressed={selected?.id === version.id}
              className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
              onClick={() => setSelected(selected?.id === version.id ? null : version)}
            >
              <span className="min-w-0 truncate">
                v{version.version} {version.label}
              </span>
              <Badge variant="outline">{version.kind}</Badge>
            </button>
          </li>
        ))}
      </ul>
      {selected !== null && (
        <section aria-label={t`Version preview`} className="space-y-3 border-t pt-3">
          {selectedContent.isPending ? (
            <LoadingRows rows={2} />
          ) : selectedContent.isError ? (
            <ErrorMessage error={selectedContent.error} />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                <Trans>Changes since the previous version</Trans>
              </p>
              <ul className="space-y-1 font-mono text-xs">
                {(diff ?? []).map((line, index) => (
                  <li
                    key={index}
                    className={
                      line.kind === "added"
                        ? "bg-emerald-500/10 px-1"
                        : line.kind === "removed"
                          ? "bg-red-500/10 px-1 line-through"
                          : "px-1 text-muted-foreground"
                    }
                  >
                    {line.text || " "}
                  </li>
                ))}
              </ul>
              {canWrite && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(selected.id)}
                >
                  <Trans>Restore this version</Trans>
                </Button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
