import { Trans } from "@lingui/react/macro"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@audit/ui/components/ui/card.tsx"
import { PageHeader } from "../components/feedback.tsx"

export const Route = createFileRoute("/_app/")({
  component: HomePage,
})

function HomePage() {
  const { me } = Route.useRouteContext()
  return (
    <>
      <PageHeader title={`${me.displayName}`} description={me.workspace.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Your account</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Update your name, language, time zone and appearance.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/settings/profile" className="text-sm underline underline-offset-4">
              <Trans>Open profile</Trans>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Security</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Two-factor authentication, passkeys and active sessions.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/settings/security" className="text-sm underline underline-offset-4">
              <Trans>Open security</Trans>
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
