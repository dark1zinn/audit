import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation } from "@tanstack/react-query"
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

export const Route = createFileRoute("/_app/settings/privacy")({
  component: PrivacyPage,
})

function PrivacyPage() {
  const { t } = useLingui()

  const download = useMutation({
    mutationFn: async () => {
      const data = await callApi((api) => api.people.exportMine())
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const date = new Date().toISOString().slice(0, 10)
      const link = document.createElement("a")
      link.href = url
      link.download = `audit-personal-data-${date}.json`
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    },
  })

  return (
    <>
      <PageHeader title={t`Privacy`} description={t`Your personal data in this workspace.`} />
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Download your data</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              A JSON file with your profile, notification settings, the tasks, comments, messages
              and events you authored or were assigned, and the activity log entries about you.
              Content is limited to what you can currently see.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {download.error !== null && <ErrorMessage error={download.error} />}
          <Button onClick={() => download.mutate()} disabled={download.isPending}>
            {download.isPending ? <Trans>Preparing file…</Trans> : <Trans>Download JSON</Trans>}
          </Button>
        </CardContent>
      </Card>
    </>
  )
}
