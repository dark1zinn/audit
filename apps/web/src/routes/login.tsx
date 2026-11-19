import { useLingui, Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { authClient } from "../lib/auth.ts"
import { keys, sessionQuery, setupStatusQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery(sessionQuery).catch(() => null)
    if (me !== null) throw redirect({ to: "/" })
  },
  component: LoginPage,
})

type Step = "credentials" | "totp"

function LoginPage() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>("credentials")
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const setup = useQuery(setupStatusQuery)

  const finish = async () => {
    queryClient.removeQueries({ queryKey: keys.session })
    await navigate({ to: "/" })
  }

  const run = async (action: () => Promise<{ error: { message?: string | undefined } | null }>) => {
    setPending(true)
    setFailed(null)
    try {
      const result = await action()
      if (result.error) {
        setFailed(t`Sign-in failed. Check your details and try again.`)
        return false
      }
      return true
    } catch {
      setFailed(t`Cannot reach the server. Check your connection.`)
      return false
    } finally {
      setPending(false)
    }
  }

  const onCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const nextEmail = formValue(form, "email")
    const nextPassword = formValue(form, "password")
    setPending(true)
    setFailed(null)
    try {
      const result = await authClient.signIn.email({ email: nextEmail, password: nextPassword })
      if (result.error) {
        setFailed(t`Sign-in failed. Check your details and try again.`)
        return
      }
      if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        setStep("totp")
        return
      }
      await finish()
    } catch {
      setFailed(t`Cannot reach the server. Check your connection.`)
    } finally {
      setPending(false)
    }
  }

  const onTotp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = formValue(event.currentTarget, "code")
    if (await run(() => authClient.twoFactor.verifyTotp({ code }))) await finish()
  }

  const onPasskey = async () => {
    if (await run(() => authClient.signIn.passkey())) await finish()
  }

  if (step === "totp") {
    return (
      <AuthLayout
        title={t`Two-factor authentication`}
        description={t`Enter the 6-digit code from your authenticator app, or a backup code.`}
      >
        <form className="space-y-4" onSubmit={(event) => void onTotp(event)}>
          <TextField
            name="code"
            label={t`Code`}
            inputMode="text"
            autoComplete="one-time-code"
            required
          />
          {failed !== null && (
            <p role="alert" className="text-sm text-destructive">
              {failed}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            <Trans>Verify</Trans>
          </Button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t`Sign in`} description={t`Sign in to your workspace.`}>
      <form className="space-y-4" onSubmit={(event) => void onCredentials(event)}>
        <TextField
          name="email"
          type="email"
          label={t`Email`}
          autoComplete="username webauthn"
          required
        />
        <TextField
          name="password"
          type="password"
          label={t`Password`}
          autoComplete="current-password"
          required
        />
        {failed !== null && (
          <p role="alert" className="text-sm text-destructive">
            {failed}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          <Trans>Sign in</Trans>
        </Button>
      </form>
      <div className="relative py-1 text-center text-xs text-muted-foreground">
        <span className="bg-card px-2">
          <Trans>or</Trans>
        </span>
      </div>
      <Button
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={() => void onPasskey()}
      >
        <Trans>Sign in with a passkey</Trans>
      </Button>
      {setup.data?.emailEnabled === true && (
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="underline underline-offset-4">
            <Trans>Forgot password?</Trans>
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
