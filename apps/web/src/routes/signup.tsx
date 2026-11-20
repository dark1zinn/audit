import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useRef, type FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { ErrorMessage } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { errorKind } from "../lib/errors.ts"

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>) => ({
    verify: typeof search.verify === "string" ? search.verify : undefined,
  }),
  component: SignupPage,
})

type SignupInput = { readonly name: string; readonly email: string; readonly password: string }

/**
 * Public self sign-up, outside `_app`: works signed out. The workspace sign-up policy decides
 * whether the server accepts the request; a closed policy answers `Forbidden`. An accepted request
 * waits for the emailed link (`?verify=`) or for an administrator's approval; it never signs in.
 */
function SignupPage() {
  const { t } = useLingui()
  const { verify: verifyToken } = Route.useSearch()
  const started = useRef(false)

  const signup = useMutation({
    mutationFn: (input: SignupInput) =>
      callApi((api) =>
        api.signup.signup({
          payload: {
            ...input,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      ),
  })

  const verify = useMutation({
    mutationFn: (token: string) =>
      callApi((api) => api.signup.verifySignup({ payload: { token } })),
  })
  const verifyLink = verify.mutate

  useEffect(() => {
    if (verifyToken === undefined || started.current) return
    started.current = true
    verifyLink(verifyToken)
  }, [verifyToken, verifyLink])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    signup.mutate({
      name: formValue(form, "name"),
      email: formValue(form, "email"),
      password: formValue(form, "password"),
    })
  }

  if (verifyToken !== undefined) {
    return (
      <AuthLayout
        title={t`Confirm your sign-up`}
        description={t`Opening the link from your email creates your account.`}
      >
        {verify.isSuccess && (
          <Link to="/login" className="text-sm underline underline-offset-4">
            <Trans>Account created. Go to sign in</Trans>
          </Link>
        )}
        {verify.isError && (
          <>
            <ErrorMessage error={verify.error} />
            <Link
              to="/signup"
              search={{ verify: undefined }}
              className="text-sm underline underline-offset-4"
            >
              <Trans>Back to sign-up</Trans>
            </Link>
          </>
        )}
      </AuthLayout>
    )
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
        description={t`If this address can sign up, we sent a link to confirm it. The link is valid for 24 hours.`}
      >
        <Link to="/login" className="text-sm underline underline-offset-4">
          <Trans>Back to sign in</Trans>
        </Link>
      </AuthLayout>
    ) : (
      <AuthLayout
        title={t`Request received`}
        description={t`An administrator reviews new accounts. You can sign in once your request is approved.`}
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
        <TextField name="name" label={t`Your name`} autoComplete="name" required maxLength={120} />
        <TextField name="email" type="email" label={t`Email`} autoComplete="email" required />
        <TextField
          name="password"
          type="password"
          label={t`Password`}
          autoComplete="new-password"
          required
          minLength={10}
          hint={<Trans>At least 10 characters.</Trans>}
        />
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
