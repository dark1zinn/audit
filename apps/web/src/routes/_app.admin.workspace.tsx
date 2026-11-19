import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import type { Locale, WorkspaceSettings } from "@audit/domain/identity/schema"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { Switch } from "@audit/ui/components/ui/switch.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { keys, workspaceQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/workspace")({
  component: WorkspacePage,
})

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
}

function WorkspacePage() {
  const workspace = useQuery(workspaceQuery)

  if (workspace.isPending) return <LoadingRows />
  if (workspace.isError) return <ErrorMessage error={workspace.error} />

  return <WorkspaceForm key={workspace.dataUpdatedAt} initial={workspace.data} />
}

function WorkspaceForm({
  initial,
}: {
  readonly initial: {
    readonly name: string
    readonly settings: WorkspaceSettings
  }
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<WorkspaceSettings>(initial.settings)

  const save = useMutation({
    mutationFn: (input: { name: string; settings: WorkspaceSettings }) =>
      callApi((api) => api.workspace.update({ payload: input })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.workspace })
      await queryClient.invalidateQueries({ queryKey: keys.session })
      toast.success(t`Workspace settings saved`)
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    save.mutate({
      name: formValue(form, "name").trim(),
      settings: {
        ...settings,
        accentColor: formValue(form, "accentColor"),
        sessionDays: Number(formValue(form, "sessionDays")),
        idleDays: Number(formValue(form, "idleDays")),
        trailRetentionDays: Number(formValue(form, "trailRetentionDays")),
      },
    })
  }

  return (
    <>
      <PageHeader
        title={t`Workspace settings`}
        description={t`Defaults and policies for everyone in the workspace.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>General</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Changing these affects new sessions and the look of the app for everyone.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5 sm:grid-cols-2" onSubmit={onSubmit}>
            <TextField
              name="accentColor"
              type="color"
              label={t`Accent color`}
              defaultValue={settings.accentColor}
            />
            <TextField
              name="name"
              label={t`Workspace name`}
              defaultValue={initial.name}
              required
              maxLength={80}
            />
            <div className="space-y-2">
              <Label htmlFor="defaultLocale">
                <Trans>Default language</Trans>
              </Label>
              <Select
                value={settings.defaultLocale}
                onValueChange={(value) =>
                  setSettings({ ...settings, defaultLocale: value as Locale })
                }
              >
                <SelectTrigger id="defaultLocale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOCALE_NAMES) as Locale[]).map((code) => (
                    <SelectItem key={code} value={code}>
                      {LOCALE_NAMES[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultTheme">
                <Trans>Default theme</Trans>
              </Label>
              <Select
                value={settings.defaultTheme}
                onValueChange={(value) =>
                  setSettings({
                    ...settings,
                    defaultTheme: value as WorkspaceSettings["defaultTheme"],
                  })
                }
              >
                <SelectTrigger id="defaultTheme" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">{t`Light`}</SelectItem>
                  <SelectItem value="dark">{t`Dark`}</SelectItem>
                  <SelectItem value="system">{t`System`}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="twoFactorPolicy">
                <Trans>Two-factor policy</Trans>
              </Label>
              <Select
                value={settings.twoFactorPolicy}
                onValueChange={(value) =>
                  setSettings({
                    ...settings,
                    twoFactorPolicy: value as WorkspaceSettings["twoFactorPolicy"],
                  })
                }
              >
                <SelectTrigger id="twoFactorPolicy" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t`Optional`}</SelectItem>
                  <SelectItem value="admins">{t`Required for admins`}</SelectItem>
                  <SelectItem value="everyone">{t`Required for everyone`}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <Label htmlFor="membersCanInvite">
                <Trans>Members can invite others</Trans>
              </Label>
              <Switch
                id="membersCanInvite"
                checked={settings.membersCanInvite}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, membersCanInvite: checked })
                }
              />
            </div>
            <TextField
              name="sessionDays"
              type="number"
              label={t`Session length (days)`}
              defaultValue={settings.sessionDays}
              min={1}
              max={365}
            />
            <TextField
              name="idleDays"
              type="number"
              label={t`Idle timeout (days)`}
              defaultValue={settings.idleDays}
              min={1}
              max={90}
            />
            <TextField
              name="trailRetentionDays"
              type="number"
              label={t`Audit log retention (days)`}
              defaultValue={settings.trailRetentionDays}
              min={30}
              max={3650}
            />
            {save.error !== null && (
              <div className="sm:col-span-2">
                <ErrorMessage error={save.error} />
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                <Trans>Save settings</Trans>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
