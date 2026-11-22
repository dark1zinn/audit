import { t as tMacro } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Badge } from "@audit/ui/components/ui/badge.tsx"
import { Button } from "@audit/ui/components/ui/button.tsx"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { Input } from "@audit/ui/components/ui/input.tsx"
import { Label } from "@audit/ui/components/ui/label.tsx"
import { ErrorMessage, LoadingRows, PageHeader } from "../components/feedback.tsx"
import { fieldWidth } from "../components/form.tsx"
import { callApi } from "../lib/api.ts"
import { adminEmailQuery } from "../lib/queries.ts"

export const Route = createFileRoute("/_app/admin/email")({
  staticData: { crumb: () => ({ label: tMacro`Email` }) },
  component: EmailPage,
})

function EmailPage() {
  const { t } = useLingui()
  const status = useQuery(adminEmailQuery)
  const [to, setTo] = useState("")

  const sendTest = useMutation({
    mutationFn: (recipient: string) =>
      callApi((api) => api.admin.emailTest({ payload: { to: recipient } })),
    onSuccess: () => toast.success(t`Test email sent`),
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sendTest.mutate(to.trim())
  }

  return (
    <>
      <PageHeader
        title={t`Email`}
        description={t`Outgoing email delivery for invitations and notifications.`}
      />
      {status.isPending && <LoadingRows />}
      {status.isError && <ErrorMessage error={status.error} />}
      {status.data !== undefined && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Delivery</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>Configured on the server through environment settings.</Trans>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {status.data.enabled ? (
                <Badge>
                  <Trans>Enabled</Trans>
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <Trans>Not configured</Trans>
                </Badge>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Send a test email</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>Checks that the server can deliver mail to an address you choose.</Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="testRecipient">
                    <Trans>Recipient</Trans>
                  </Label>
                  <Input
                    id="testRecipient"
                    className={fieldWidth.md}
                    type="email"
                    value={to}
                    disabled={!status.data.enabled}
                    onChange={(event) => setTo(event.currentTarget.value)}
                  />
                </div>
                {sendTest.error !== null && <ErrorMessage error={sendTest.error} />}
                <Button
                  type="submit"
                  disabled={!status.data.enabled || to.trim() === "" || sendTest.isPending}
                >
                  <Trans>Send test email</Trans>
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
