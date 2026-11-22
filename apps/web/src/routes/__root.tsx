import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router"
import { Trans, useLingui } from "@lingui/react/macro"
import { Button } from "@audit/ui/components/ui/button.tsx"
import { AuthLayout } from "../components/auth-layout.tsx"

/** Unknown URL outside `_app`. Signed-in users never reach this: `_app.$` renders inside the shell. */
function NotFound() {
  const { t } = useLingui()
  return (
    <AuthLayout
      title={t`Page not found`}
      description={t`The page you were looking for does not exist or was moved.`}
    >
      <Button asChild className="w-full">
        <Link to="/">
          <Trans>Go home</Trans>
        </Link>
      </Button>
    </AuthLayout>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
})
