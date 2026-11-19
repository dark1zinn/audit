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
        description={t`Rebuild the search index and export workspace data.`}
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
