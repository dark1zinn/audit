import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { callApi } from "../lib/api.ts"
import { formatBytes } from "../lib/format.ts"
import { adminStorageQuery, keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/storage")({
  staticData: { crumb: () => ({ label: tMacro`Storage` }) },
  component: StoragePage,
})

function StoragePage() {
  const { t, i18n } = useLingui()
  const queryClient = useQueryClient()
  const storage = useQuery(adminStorageQuery)

  const cleanup = useMutation({
    mutationFn: () => callApi((api) => api.admin.runOrphanCleanup()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.adminStorage })
      void queryClient.invalidateQueries({ queryKey: keys.adminOverview })
      toast.success(t`Orphaned files removed`)
    },
  })

  if (storage.isPending) return <LoadingRows />
  if (storage.isError) return <ErrorMessage error={storage.error} />

  const data = storage.data
  const percent = data.quotaBytes > 0 ? Math.min(100, (data.usedBytes / data.quotaBytes) * 100) : 0

  return (
    <>
      <PageHeader
        title={t`Storage`}
        description={t`Space used by uploaded files across the workspace.`}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Usage</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                {formatBytes(i18n.locale, data.usedBytes)} of{" "}
                {formatBytes(i18n.locale, data.quotaBytes)} used
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <progress
              aria-label={t`Storage used`}
              max={100}
              value={Math.round(percent)}
              className="block h-2 w-full overflow-hidden rounded-full bg-muted accent-primary"
            />
            <p>
              <Trans>
                Upload limit per file: {formatBytes(i18n.locale, data.uploadLimitBytes)}
              </Trans>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Files to review</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Orphaned files are not linked to any item. Soft-deleted files are kept until their
                retention period ends.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              <Trans>Orphaned files: {data.orphanedFiles}</Trans>
            </p>
            <p>
              <Trans>Soft-deleted files: {data.softDeletedFiles}</Trans>
            </p>
            {cleanup.error !== null && <ErrorMessage error={cleanup.error} />}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => cleanup.mutate()}
                disabled={cleanup.isPending || data.orphanedFiles === 0}
              >
                <Trans>Remove orphaned files</Trans>
              </Button>
              {data.orphanedFiles === 0 && (
                <span className="text-muted-foreground">
                  <Trans>Nothing to clean up</Trans>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
