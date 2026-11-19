import { Trans, useLingui } from "@lingui/react/macro"
import { useQueryClient, useMutation } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import type { Locale } from "@audit/domain/identity/schema"
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
import { useTheme, type Density, type ThemeMode } from "@audit/ui/theme.tsx"
import { ErrorMessage, PageHeader } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { useMe } from "../components/use-me.ts"
import { callApi } from "../lib/api.ts"
import { keys } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/settings/profile")({
  component: ProfilePage,
})

const WORKSPACE_LOCALE = "workspace"
type LocaleChoice = Locale | typeof WORKSPACE_LOCALE

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
}

function ProfilePage() {
  const { t } = useLingui()
  const me = useMe()
  const queryClient = useQueryClient()
  const { theme, setTheme, density, setDensity } = useTheme()
  const [locale, setLocale] = useState<LocaleChoice>(me.locale ?? WORKSPACE_LOCALE)

  const save = useMutation({
    mutationFn: (payload: {
      displayName: string
      title: string | null
      timezone: string
      locale: Locale | null
    }) => callApi((api) => api.me.updateProfile({ payload })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.session })
      toast.success(t`Profile saved`)
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const title = formValue(form, "title").trim()
    save.mutate({
      displayName: formValue(form, "displayName").trim(),
      title: title === "" ? null : title,
      timezone: formValue(form, "timezone").trim(),
      locale: locale === WORKSPACE_LOCALE ? null : locale,
    })
  }

  return (
    <>
      <PageHeader title={t`Profile`} description={t`How you appear in the workspace.`} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Account</Trans>
            </CardTitle>
            <CardDescription>{me.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
              <TextField
                name="displayName"
                label={t`Display name`}
                defaultValue={me.displayName}
                required
                maxLength={120}
              />
              <TextField
                name="title"
                label={t`Title`}
                defaultValue={me.title ?? ""}
                maxLength={120}
              />
              <TextField name="timezone" label={t`Time zone`} defaultValue={me.timezone} required />
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="locale">
                  <Trans>Language</Trans>
                </label>
                <Select value={locale} onValueChange={(value) => setLocale(value as LocaleChoice)}>
                  <SelectTrigger id="locale" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WORKSPACE_LOCALE}>{t`Workspace default`}</SelectItem>
                    {(Object.keys(LOCALE_NAMES) as Locale[]).map((code) => (
                      <SelectItem key={code} value={code}>
                        {LOCALE_NAMES[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {save.error !== null && (
                <div className="sm:col-span-2">
                  <ErrorMessage error={save.error} />
                </div>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  <Trans>Save profile</Trans>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Appearance</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Stored on this device only.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="flex flex-wrap gap-2" aria-label={t`Theme`}>
              {(
                [
                  ["light", t`Light`],
                  ["dark", t`Dark`],
                  ["system", t`System`],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  variant={theme === value ? "default" : "outline"}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value as ThemeMode)}
                >
                  {label}
                </Button>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap gap-2" aria-label={t`Density`}>
              {(
                [
                  ["comfortable", t`Comfortable`],
                  ["compact", t`Compact`],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  variant={density === value ? "default" : "outline"}
                  aria-pressed={density === value}
                  onClick={() => setDensity(value as Density)}
                >
                  {label}
                </Button>
              ))}
            </fieldset>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
