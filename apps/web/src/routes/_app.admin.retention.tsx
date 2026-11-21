import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import type { WorkspaceSettings } from "@audit/domain/identity/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { TextField } from "../components/form.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { callApi } from "../lib/api.ts"
import { keys, workspaceQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/retention")({
  staticData: { crumb: () => ({ label: tMacro`Retention` }) },
  component: RetentionPage,
})

function RetentionPage() {
  const { t } = useLingui()
  const workspace = useQuery(workspaceQuery)

  if (workspace.isPending) return <LoadingRows />
  if (workspace.isError) return <ErrorMessage error={workspace.error} />

  return (
    <>
      <PageHeader
        title={t`Retention`}
        description={t`How long audit records, deleted files and messages are kept.`}
      />
      <RetentionForm settings={workspace.data.settings} />
    </>
  )
}

function RetentionForm({ settings }: { readonly settings: WorkspaceSettings }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [trailDays, setTrailDays] = useState(String(settings.trailRetentionDays))
  const [softDeleteDays, setSoftDeleteDays] = useState(
    String(settings.softDeleteRetentionDays ?? ""),
  )
  const [messageDays, setMessageDays] = useState(
    settings.messageRetentionDays === null ? "" : String(settings.messageRetentionDays),
  )

  const save = useMutation({
    mutationFn: async (input: {
      readonly trailRetentionDays: number
      readonly softDeleteRetentionDays: number
      readonly messageRetentionDays: number | null
    }) => {
      await callApi((api) =>
        api.admin.updateRetention({
          payload: {
            trailRetentionDays: input.trailRetentionDays,
            softDeleteRetentionDays: input.softDeleteRetentionDays,
          },
        }),
      )
      // Message retention is a workspace setting; send the full settings object with
      // every retention value set from this form so nothing reverts.
      await callApi((api) =>
        api.workspace.update({
          payload: {
            settings: {
              ...settings,
              trailRetentionDays: input.trailRetentionDays,
              softDeleteRetentionDays: input.softDeleteRetentionDays,
              messageRetentionDays: input.messageRetentionDays,
            },
          },
        }),
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace })
      void queryClient.invalidateQueries({ queryKey: keys.adminStorage })
      void queryClient.invalidateQueries({ queryKey: keys.adminOverview })
      toast.success(t`Retention saved`)
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate({
      trailRetentionDays: Number(trailDays),
      softDeleteRetentionDays: Number(softDeleteDays),
      messageRetentionDays: messageDays.trim() === "" ? null : Number(messageDays),
    })
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <Trans>Retention periods</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Leave message retention empty to keep messages indefinitely.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <TextField
            name="trailDays"
            type="number"
            width="xs"
            min={30}
            max={3650}
            label={t`Audit log retention (days)`}
            value={trailDays}
            onChange={(event) => setTrailDays(event.currentTarget.value)}
          />
          <TextField
            name="softDeleteDays"
            type="number"
            width="xs"
            min={1}
            max={3650}
            label={t`Deleted file retention (days)`}
            value={softDeleteDays}
            onChange={(event) => setSoftDeleteDays(event.currentTarget.value)}
          />
          <TextField
            name="messageDays"
            type="number"
            width="xs"
            min={1}
            max={3650}
            label={t`Message retention (days)`}
            value={messageDays}
            onChange={(event) => setMessageDays(event.currentTarget.value)}
          />
          {save.error !== null && <ErrorMessage error={save.error} />}
          <Button type="submit" disabled={save.isPending}>
            <Trans>Save</Trans>
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
