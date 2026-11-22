import { useLingui, Trans } from "@lingui/react/macro"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"
import { ErrorMessage, LoadingRows } from "../components/feedback.tsx"
import { formValue, TextField } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { authClient } from "../lib/auth.ts"
import { invitePreviewQuery, keys } from "../lib/queries.ts"

export const Route = createFileRoute("/join/$token")({
  component: JoinPage,
})

function JoinPage() {
  const { t } = useLingui()
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const preview = useQuery(invitePreviewQuery(token))

  const accept = useMutation({
    mutationFn: async (input: { name: string; email: string; password: string }) => {
      await callApi((api) => api.join.accept({ payload: { token, ...input } }))
      const result = await authClient.signIn.email({
        email: input.email,
        password: input.password,
      })
      if (result.error) throw new Error(result.error.message ?? "sign-in failed")
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: keys.session })
      await navigate({ to: "/" })
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    accept.mutate({
      name: formValue(form, "name"),
      email: formValue(form, "email"),
      password: formValue(form, "password"),
    })
  }

  if (preview.isPending) {
    return (
      <AuthLayout title={t`Join workspace`}>
        <LoadingRows rows={3} />
      </AuthLayout>
    )
  }

  if (preview.isError) {
    return (
      <AuthLayout title={t`Invite unavailable`}>
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <Trans>
            This invite has expired or was already used. Ask the person who invited you for a new
            one.
          </Trans>
        </div>
      </AuthLayout>
    )
  }

  const invite = preview.data
  const emailLocked = invite.email !== null

  return (
    <AuthLayout
      workspaceName={invite.workspaceName}
      title={t`Join ${invite.workspaceName}`}
      description={t`Create your account to join the workspace.`}
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <TextField name="name" label={t`Your name`} autoComplete="name" required maxLength={120} />
        <TextField
          name="email"
          type="email"
          label={t`Email`}
          autoComplete="email"
          required
          defaultValue={invite.email ?? ""}
          readOnly={emailLocked}
        />
        <TextField
          name="password"
          type="password"
          label={t`Password`}
          autoComplete="new-password"
          required
          minLength={10}
          hint={<Trans>At least 10 characters.</Trans>}
        />
        {accept.error !== null && <ErrorMessage error={accept.error} />}
        <Button type="submit" className="w-full" disabled={accept.isPending}>
          <Trans>Create account and join</Trans>
        </Button>
      </form>
    </AuthLayout>
  )
}
