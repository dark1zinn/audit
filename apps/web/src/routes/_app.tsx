import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useEffect } from "react"
import { AppShell } from "../components/app-shell.tsx"
import { startRealtime } from "../lib/realtime.ts"
import { sessionQuery } from "../lib/queries.ts"

/** Every route under `_app` needs a session; without one the user goes to /login. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery(sessionQuery).catch(() => null)
    if (me === null) throw redirect({ to: "/login" })
    return { me }
  },
  component: AppLayout,
})

function AppLayout() {
  const queryClient = useQueryClient()
  const { me: initial } = Route.useRouteContext()
  const me = useQuery(sessionQuery).data ?? initial

  useEffect(() => startRealtime(queryClient), [queryClient])

  return (
    <AppShell me={me}>
      <Outlet />
    </AppShell>
  )
}
