import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@audit/ui/components/ui/select.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { fieldWidth } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { keys, workspaceQuery } from "../lib/queries.ts"
import { uploadBrandingLogo } from "../lib/upload.ts"

export const Route = createFileRoute("/_app/admin/branding")({
  staticData: { crumb: () => ({ label: tMacro`Branding` }) },
  component: BrandingPage,
})

type Theme = "light" | "dark" | "system"

function BrandingPage() {
  const { t } = useLingui()
  const workspace = useQuery(workspaceQuery)

  if (workspace.isPending) return <LoadingRows />
  if (workspace.isError) return <ErrorMessage error={workspace.error} />

  const settings = workspace.data.settings
  return (
    <>
      <PageHeader
        title={t`Branding`}
        description={t`The name, accent colour and default theme shown to everyone in the workspace.`}
      />
      <LogoForm logoFileId={workspace.data.logoFileId} />
      <BrandingForm
        initialName={workspace.data.name}
        initialAccent={settings.accentColor}
        initialTheme={settings.defaultTheme}
      />
    </>
  )
}

function LogoForm({ logoFileId }: { readonly logoFileId: string | undefined }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const upload = useMutation({
    mutationFn: (file: File) => uploadBrandingLogo(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace })
      void queryClient.invalidateQueries({ queryKey: keys.session })
      toast.success(t`Logo updated`)
    },
  })

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <Trans>Logo</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>PNG, JPEG, GIF or WebP. Shown in the app shell and on the sign-in page.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {logoFileId !== undefined && (
          <img
            src={`/files/${logoFileId}`}
            alt={t`Current workspace logo`}
            className="h-12 w-auto"
          />
        )}
        {upload.error !== null && <ErrorMessage error={upload.error} />}
        <Label htmlFor="brandLogo">
          <Trans>Upload logo</Trans>
        </Label>
        <Input
          id="brandLogo"
          className={fieldWidth.md}
          type="file"
          accept="image/*"
          disabled={upload.isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file !== undefined) upload.mutate(file)
          }}
        />
      </CardContent>
    </Card>
  )
}

function BrandingForm({
  initialName,
  initialAccent,
  initialTheme,
}: {
  readonly initialName: string
  readonly initialAccent: string
  readonly initialTheme: Theme
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [name, setName] = useState(initialName)
  const [accent, setAccent] = useState(initialAccent)
  const [theme, setTheme] = useState<Theme>(initialTheme)

  const save = useMutation({
    mutationFn: () =>
      callApi((api) =>
        api.admin.updateBranding({
          payload: { name: name.trim(), accentColor: accent, defaultTheme: theme },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace })
      void queryClient.invalidateQueries({ queryKey: keys.session })
      void queryClient.invalidateQueries({ queryKey: keys.adminOverview })
      toast.success(t`Branding saved`)
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <Trans>Workspace appearance</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Applies to the sign-in page and the app shell.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="brandName">
              <Trans>Workspace name</Trans>
            </Label>
            <Input
              id="brandName"
              className={fieldWidth.md}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brandAccent">
              <Trans>Accent colour</Trans>
            </Label>
            <Input
              id="brandAccent"
              type="color"
              className="h-10 w-24 p-1"
              value={accent}
              onChange={(event) => setAccent(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brandTheme">
              <Trans>Default theme</Trans>
            </Label>
            <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <SelectTrigger id="brandTheme" className={fieldWidth.sm}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t`Light`}</SelectItem>
                <SelectItem value="dark">{t`Dark`}</SelectItem>
                <SelectItem value="system">{t`System`}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {save.error !== null && <ErrorMessage error={save.error} />}
          <Button type="submit" disabled={save.isPending}>
            <Trans>Save</Trans>
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
