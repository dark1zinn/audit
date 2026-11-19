import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { isWorkspaceAdmin } from "@audit/domain/roles"

/** Owners and admins only. Everyone else is sent to the home page. */
export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (!isWorkspaceAdmin(context.me.role)) throw redirect({ to: "/" })
  },
  component: () => <Outlet />,
})
