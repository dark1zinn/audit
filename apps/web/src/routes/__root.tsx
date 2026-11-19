import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router"
import { Trans } from "@lingui/react/macro"

function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">
        <Trans>Page not found</Trans>
      </h1>
      <Link to="/" className="text-sm underline underline-offset-4">
        <Trans>Go home</Trans>
      </Link>
    </div>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
})
