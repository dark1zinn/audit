import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { ErrorMessage, PageHeader } from "../components/feedback.tsx"
import { callApi } from "../lib/api.ts"
import { keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/maintenance")({
  component: MaintenancePage,
})

function MaintenancePage() {
  const { t } = useLingui()
  const queryClient = useQueryClient()

  const reindexStatus = useQuery({
    queryKey: ["search", "reindex"],
    queryFn: () => callApi((api) => api.search.reindexStatus()),
    refetchInterval: (query) => (query.state.data?.state === "queued" ? 1500 : false),
  })
  const queued = reindexStatus.data?.state === "queued"

  const reindex = useMutation({
    mutationFn: () => callApi((api) => api.search.reindex()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["search"] })
    },
  })

  const maintenance = useQuery({
    queryKey: keys.adminMaintenance,
    queryFn: () => callApi((api) => api.admin.maintenance()),
    refetchInterval: (query) =>
      query.state.data?.rebalance.state === "queued" ||
      query.state.data?.compaction.state === "queued"
        ? 1500
        : false,
  })
  const rebalanceQueued = maintenance.data?.rebalance.state === "queued"
  const compactionQueued = maintenance.data?.compaction.state === "queued"

  const rebalance = useMutation({
    mutationFn: () => callApi((api) => api.admin.rebalanceBoards()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.adminMaintenance })
    },
  })

  const compaction = useMutation({
    mutationFn: () => callApi((api) => api.admin.compactDocs()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.adminMaintenance })
    },
  })

  // The server streams the file, so the browser downloads it straight from the route.
  const downloadExport = () => {
    const link = document.createElement("a")
    link.href = "/api/admin/export"
    link.download = "workspace-export.jsonl"
    link.click()
    void queryClient.invalidateQueries({ queryKey: keys.adminOverview })
  }

  return (
    <>
      <PageHeader
        title={t`Maintenance`}
        description={t`Rebuild the search index, rebalance boards, compact docs and export workspace data.`}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Search index</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Rebuilds the search index from current data. Search may be slow meanwhile.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reindex.error !== null && <ErrorMessage error={reindex.error} />}
            {queued && (
              <p className="text-sm text-muted-foreground">
                <Trans>Rebuild queued. This page updates when it finishes.</Trans>
              </p>
            )}
            {reindexStatus.data?.state === "done" && (
              <p className="text-sm text-muted-foreground">
                <Trans>Search index rebuilt for {reindexStatus.data.updated ?? 0} items.</Trans>
              </p>
            )}
            <Button onClick={() => reindex.mutate()} disabled={reindex.isPending || queued}>
              <Trans>Rebuild search index</Trans>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Board positions</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Rewrites column and task position keys on every board into short, evenly spaced
                keys. Task order does not change.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rebalance.error !== null && <ErrorMessage error={rebalance.error} />}
            {rebalanceQueued && (
              <p className="text-sm text-muted-foreground">
                <Trans>Rebalance queued. This page updates when it finishes.</Trans>
              </p>
            )}
            {maintenance.data?.rebalance.state === "done" && (
              <p className="text-sm text-muted-foreground">
                <Trans>Rebalanced {maintenance.data.rebalance.count ?? 0} boards.</Trans>
              </p>
            )}
            <Button
              onClick={() => rebalance.mutate()}
              disabled={rebalance.isPending || rebalanceQueued}
            >
              <Trans>Rebalance all boards</Trans>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Doc compaction</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Rebuilds large docs from their content to drop accumulated edit history. The
                previous state is kept as a version. Docs open right now are skipped.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {compaction.error !== null && <ErrorMessage error={compaction.error} />}
            {compactionQueued && (
              <p className="text-sm text-muted-foreground">
                <Trans>Compaction queued. This page updates when it finishes.</Trans>
              </p>
            )}
            {maintenance.data?.compaction.state === "done" && (
              <p className="text-sm text-muted-foreground">
                <Trans>Compacted {maintenance.data.compaction.count ?? 0} docs.</Trans>
              </p>
            )}
            <Button
              onClick={() => compaction.mutate()}
              disabled={compaction.isPending || compactionQueued}
            >
              <Trans>Compact docs</Trans>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Export</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Download every workspace record as JSON Lines.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" onClick={downloadExport}>
              <Trans>Download export</Trans>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
