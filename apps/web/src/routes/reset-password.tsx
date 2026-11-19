import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Schema } from "effect"
import type { FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { ErrorMessage } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { authClient } from "../lib/auth.ts"

export const Route = createFileRoute("/reset-password")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ token: Schema.optionalKey(Schema.String) }),
  ),
  component: ResetPasswordPage,
})

/** Opened from a one-time link an admin created (or, with SMTP, from a reset email). */
function ResetPasswordPage() {
  const { t } = useLingui()
  const { token } = Route.useSearch()

  const reset = useMutation({
    mutationFn: async (newPassword: string) => {
      const result = await authClient.resetPassword({ newPassword, token: token ?? "" })
      if (result.error) throw new Error(result.error.message ?? "reset failed")
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    reset.mutate(formValue(event.currentTarget, "password"))
  }

  if (token === undefined) {
    return (
      <AuthLayout title={t`Reset password`}>
        <p className="text-sm text-muted-foreground">
          <Trans>This link is incomplete. Ask an admin for a new password-reset link.</Trans>
        </p>
      </AuthLayout>
    )
  }

  if (reset.isSuccess) {
    return (
      <AuthLayout title={t`Password changed`}>
        <p className="text-sm text-muted-foreground">
          <Trans>Your password was changed. You can now sign in with it.</Trans>
        </p>
        <Button asChild className="mt-4 w-full">
          <Link to="/login">
            <Trans>Go to sign in</Trans>
          </Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t`Reset password`} description={t`Choose a new password for your account.`}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <TextField
          name="password"
          type="password"
          label={t`New password`}
          autoComplete="new-password"
          required
          minLength={10}
          hint={<Trans>At least 10 characters.</Trans>}
        />
        {reset.error !== null && <ErrorMessage error={reset.error} />}
        <Button type="submit" className="w-full" disabled={reset.isPending}>
          <Trans>Change password</Trans>
        </Button>
      </form>
    </AuthLayout>
  )
}
