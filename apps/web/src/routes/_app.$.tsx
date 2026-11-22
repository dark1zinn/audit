import { createFileRoute, Link } from "@tanstack/react-router"
import { Trans, useLingui } from "@lingui/react/macro"
import { FileQuestion } from "lucide-react"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { EmptyState } from "../components/feedback.tsx"

/** Unknown URL under `_app`: renders inside the shell; the `_app` guard handles signed-out users. */
export const Route = createFileRoute("/_app/$")({
  component: NotFoundPage,
})

function NotFoundPage() {
  const { t } = useLingui()
  return (
    <EmptyState
      icon={FileQuestion}
      title={t`Page not found`}
      description={t`The page you were looking for does not exist or was moved.`}
      action={
        <Button asChild>
          <Link to="/">
            <Trans>Go home</Trans>
          </Link>
        </Button>
      }
    />
  )
}
