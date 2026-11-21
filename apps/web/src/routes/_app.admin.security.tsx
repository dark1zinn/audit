import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
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
import { Label } from "@audit/ui/components/ui/label.tsx"
import { Switch } from "@audit/ui/components/ui/switch.tsx"
import { Textarea } from "@audit/ui/components/ui/textarea.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { callApi } from "../lib/api.ts"
import { keys, workspaceQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/security")({
  staticData: { crumb: () => ({ label: tMacro`Security` }) },
  component: SecurityPage,
})

/** Password policy minimum; mirrors the `Password` schema in `@audit/domain/identity/schema`. */
const MIN_PASSWORD_LENGTH = 10

function SecurityPage() {
  const { t } = useLingui()
  const workspace = useQuery(workspaceQuery)

  if (workspace.isPending) return <LoadingRows />
  if (workspace.isError) return <ErrorMessage error={workspace.error} />

  const { signupPolicy, settings } = workspace.data
  return (
    <>
      <PageHeader
        title={t`Security`}
        description={t`Sign-up rules and password checks for the whole workspace.`}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <SecurityForm
          initialMode={signupPolicy.mode === "domains" ? "domains" : "closed"}
          initialDomains={signupPolicy.domains}
          initialBreachedCheck={settings.breachedPasswordCheck ?? false}
        />
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Session and sign-in</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Session length, idle timeout and two-factor policy are edited in workspace settings.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <Trans>Session length: {settings.sessionDays} days</Trans>
            </p>
            <p>
              <Trans>Idle timeout: {settings.idleDays} days</Trans>
            </p>
            <p>
              <Trans>Minimum password length: {MIN_PASSWORD_LENGTH}</Trans>
            </p>
            <Link to="/admin/workspace" className="text-primary underline">
              <Trans>Open workspace settings</Trans>
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function SecurityForm({
  initialMode,
  initialDomains,
  initialBreachedCheck,
}: {
  readonly initialMode: "closed" | "domains"
  readonly initialDomains: readonly string[]
  readonly initialBreachedCheck: boolean
}) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<"closed" | "domains">(initialMode)
  const [domainsText, setDomainsText] = useState(initialDomains.join("\n"))
  const [breachedCheck, setBreachedCheck] = useState(initialBreachedCheck)

  const save = useMutation({
    mutationFn: (input: {
      readonly mode: "closed" | "domains"
      readonly domains: readonly string[]
      readonly breachedCheck: boolean
    }) =>
      callApi((api) =>
        api.admin.updateSecurity({
          payload: {
            signupPolicy: { mode: input.mode, domains: [...input.domains] },
            breachedPasswordCheck: input.breachedCheck,
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace })
      void queryClient.invalidateQueries({ queryKey: keys.adminOverview })
      toast.success(t`Security settings saved`)
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate({
      mode,
      domains: parseDomains(domainsText),
      breachedCheck,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Sign-up</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>Choose who can create an account on this workspace.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={onSubmit}>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              <Trans>Sign-up policy</Trans>
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="signupMode"
                value="closed"
                checked={mode === "closed"}
                onChange={() => setMode("closed")}
              />
              <Trans>Closed: people join only by invitation</Trans>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="signupMode"
                value="domains"
                checked={mode === "domains"}
                onChange={() => setMode("domains")}
              />
              <Trans>Open to listed email domains</Trans>
            </label>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="signupDomains">
              <Trans>Allowed email domains</Trans>
            </Label>
            <Textarea
              id="signupDomains"
              rows={4}
              value={domainsText}
              disabled={mode !== "domains"}
              placeholder={t`example.com`}
              onChange={(event) => setDomainsText(event.currentTarget.value)}
            />
            <p className="text-xs text-muted-foreground">
              <Trans>One domain per line or comma separated.</Trans>
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="breachedCheck">
                <Trans>Check passwords against breach lists</Trans>
              </Label>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Rejects passwords found in known breaches. Minimum length is {MIN_PASSWORD_LENGTH}{" "}
                  characters.
                </Trans>
              </p>
            </div>
            <Switch id="breachedCheck" checked={breachedCheck} onCheckedChange={setBreachedCheck} />
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

/** Splits free-text domains on newlines, commas and spaces, lower-cases and drops blanks. */
function parseDomains(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0)
}
