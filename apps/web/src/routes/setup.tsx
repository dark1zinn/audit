import { useLingui, Trans } from "@lingui/react/macro"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { ErrorMessage } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { authClient } from "../lib/auth.ts"
import { callApi } from "../lib/api.ts"
import { setupStatusQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(setupStatusQuery).catch(() => null)
    if (status?.needsSetup === false) throw redirect({ to: "/login" })
  },
  component: SetupPage,
})

interface SetupForm {
  readonly token: string
  readonly workspaceName: string
  readonly name: string
  readonly email: string
  readonly password: string
}

function SetupPage() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const setup = useMutation({
    mutationFn: async (input: SetupForm) => {
      await callApi((api) => api.setup.complete({ payload: input }))
      const result = await authClient.signIn.email({
        email: input.email,
        password: input.password,
      })
      if (result.error) throw new Error(result.error.message ?? "sign-in failed")
    },
    onSuccess: async () => {
      queryClient.removeQueries()
      await navigate({ to: "/" })
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    setup.mutate({
      token: formValue(form, "token"),
      workspaceName: formValue(form, "workspaceName"),
      name: formValue(form, "name"),
      email: formValue(form, "email"),
      password: formValue(form, "password"),
    })
  }

  return (
    <AuthLayout
      title={t`Set up your workspace`}
      description={t`Use the setup token printed by the server when it first started.`}
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <TextField name="token" label={t`Setup token`} autoComplete="off" required />
        <TextField name="workspaceName" label={t`Workspace name`} required maxLength={80} />
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
        {setup.error !== null && <ErrorMessage error={setup.error} />}
        <Button type="submit" className="w-full" disabled={setup.isPending}>
          <Trans>Create workspace</Trans>
        </Button>
      </form>
    </AuthLayout>
  )
}
