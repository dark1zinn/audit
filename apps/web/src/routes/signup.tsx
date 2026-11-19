import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { ErrorMessage } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { authClient } from "../lib/auth.ts"
import { errorKind } from "../lib/errors.ts"
import { keys } from "../lib/queries.ts"

export const Route = createFileRoute("/signup")({
  component: SignupPage,
})

type SignupInput = { readonly name: string; readonly email: string; readonly password: string }

/**
 * Public self sign-up, outside `_app`: works signed out. The workspace sign-up policy decides
 * whether the server accepts the request; a closed policy answers `Forbidden`.
 */
function SignupPage() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [created, setCreated] = useState(false)

  const signup = useMutation({
    mutationFn: async (input: SignupInput) => {
      await callApi((api) =>
        api.signup.signup({
          payload: {
            ...input,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      )
      setCreated(true)
      const result = await authClient.signIn.email({
        email: input.email,
        password: input.password,
      })
      return { signedIn: !result.error }
    },
    onSuccess: async ({ signedIn }) => {
      if (!signedIn) return
      queryClient.removeQueries({ queryKey: keys.session })
      await navigate({ to: "/" })
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    signup.mutate({
      name: formValue(form, "name"),
      email: formValue(form, "email"),
      password: formValue(form, "password"),
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

  if (created && signup.data?.signedIn !== true && !signup.isPending) {
    return (
      <AuthLayout
        title={t`Account created`}
        description={t`Your account is ready. Sign in to continue.`}
      >
        <Link to="/login" className="text-sm underline underline-offset-4">
          <Trans>Go to sign in</Trans>
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
