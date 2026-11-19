import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { ErrorMessage } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { authClient } from "../lib/auth.ts"

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
})

/** Sends a reset email. The reply is the same whether or not the address has an account. */
function ForgotPasswordPage() {
  const { t } = useLingui()

  const request = useMutation({
    mutationFn: async (email: string) => {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      })
      if (result.error) throw new Error(result.error.message ?? "request failed")
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    request.mutate(formValue(event.currentTarget, "email"))
  }

  if (request.isSuccess) {
    return (
      <AuthLayout title={t`Check your email`}>
        <p className="text-sm text-muted-foreground">
          <Trans>
            If an account exists for that address, a password-reset link is on its way. The link
            expires soon.
          </Trans>
        </p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link to="/login">
            <Trans>Back to sign in</Trans>
          </Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t`Forgot password`}
      description={t`Enter your email and we will send you a reset link.`}
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <TextField name="email" type="email" label={t`Email`} autoComplete="email" required />
        {request.error !== null && <ErrorMessage error={request.error} />}
        <Button type="submit" className="w-full" disabled={request.isPending}>
          <Trans>Send reset link</Trans>
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="underline underline-offset-4">
            <Trans>Back to sign in</Trans>
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
