import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { ErrorMessage } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { errorKind } from "../lib/errors.ts"

export const Route = createFileRoute("/signup")({
  component: SignupPage,
})

type SignupInput = { readonly name: string; readonly email: string }

/**
 * Public self sign-up, outside `_app`: works signed out. The workspace sign-up policy decides
 * whether the server accepts the request; a closed policy answers `Forbidden`. An accepted request
 * either mails an invite link to the address or waits for an administrator; it never signs in.
 */
function SignupPage() {
  const { t } = useLingui()

  const signup = useMutation({
    mutationFn: (input: SignupInput) => callApi((api) => api.signup.signup({ payload: input })),
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    signup.mutate({
      name: formValue(form, "name"),
      email: formValue(form, "email"),
    })
  }

  if (signup.error !== null && errorKind(signup.error) === "forbidden") {
    return (
      <AuthLayout
        title={t`Sign-up is closed`}
        description={t`This workspace is not accepting new accounts right now. Ask an administrator for an invite.`}
      >
        <Link to="/login" className="text-sm underline underline-offset-4">
          <Trans>Back to sign in</Trans>
        </Link>
      </AuthLayout>
    )
  }

  if (signup.isSuccess) {
    return signup.data.delivery === "email" ? (
      <AuthLayout
        title={t`Check your email`}
        description={t`If this address can sign up, we sent it an invite link. Open it to choose your password.`}
      >
        <Link to="/login" className="text-sm underline underline-offset-4">
          <Trans>Back to sign in</Trans>
        </Link>
      </AuthLayout>
    ) : (
      <AuthLayout
        title={t`Request received`}
        description={t`An administrator reviews new requests. Once approved, you receive an invite link to choose your password.`}
      >
        <Link to="/login" className="text-sm underline underline-offset-4">
          <Trans>Back to sign in</Trans>
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t`Create account`} description={t`Sign up to join this workspace.`}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <TextField
          name="name"
          label={t`Your name (optional)`}
          autoComplete="name"
          maxLength={120}
        />
        <TextField name="email" type="email" label={t`Email`} autoComplete="email" required />
        {signup.error !== null && <ErrorMessage error={signup.error} />}
        <Button type="submit" className="w-full" disabled={signup.isPending}>
          <Trans>Create account</Trans>
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        <Link to="/login" className="underline underline-offset-4">
          <Trans>Already have an account? Sign in</Trans>
        </Link>
      </p>
    </AuthLayout>
  )
}
