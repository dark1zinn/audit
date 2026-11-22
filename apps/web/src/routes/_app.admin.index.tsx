import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
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
import { adminOverviewQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/")({
  staticData: { crumb: () => ({ label: tMacro`Overview` }) },
  component: OverviewPage,
})

function OverviewPage() {
  const { t, i18n } = useLingui()
  const overview = useQuery(adminOverviewQuery)
  const verify = useMutation({
    mutationFn: () => callApi((api) => api.trail.verify()),
  })

  if (overview.isPending) return <LoadingRows />
  if (overview.isError) return <ErrorMessage error={overview.error} />

  const data = overview.data
  const signupLabel =
    data.signupPolicy.mode === "closed"
      ? t`Closed`
      : t`Allowed domains: ${data.signupPolicy.domains.join(", ")}`

  return (
    <>
      <PageHeader title={t`Overview`} description={t`Workspace health at a glance.`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Trans>Version</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{data.version}</p>
            <p className="text-muted-foreground">{data.gitSha ?? t`Unknown build`}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Trans>Members</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{data.members}</p>
            <p className="text-muted-foreground">
              <Trans>
                {data.owners} owners, {data.admins} admins, {data.pendingInvites} pending invites
              </Trans>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Trans>Storage</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              {formatBytes(i18n.locale, data.storage.usedBytes)} /{" "}
              {formatBytes(i18n.locale, data.storage.quotaBytes)}
            </p>
            <p className="text-muted-foreground">
              <Trans>Upload limit {formatBytes(i18n.locale, data.storage.uploadLimitBytes)}</Trans>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Trans>Email</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{data.emailEnabled ? t`Configured` : t`Not configured`}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Trans>Sign-up</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{signupLabel}</p>
            <p className="text-muted-foreground">
              {data.breachedPasswordCheck
                ? t`Breached-password check on`
                : t`Breached-password check off`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <Trans>Audit log</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>{data.trailEvents} events recorded.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {verify.data !== undefined && (
              <p>
                {verify.data.ok ? (
                  <Trans>Chain intact ({verify.data.checked} checked)</Trans>
                ) : (
                  <Trans>Chain broken at sequence {verify.data.firstBrokenPos ?? "?"}</Trans>
                )}
              </p>
            )}
            {verify.error !== null && <ErrorMessage error={verify.error} />}
            <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
              <Trans>Verify integrity</Trans>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
