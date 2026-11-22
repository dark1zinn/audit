import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { authClient } from "../../lib/auth.ts"

/** Ends the session, drops cached data and returns to the sign-in page. */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async () => {
    await authClient.signOut()
    queryClient.removeQueries()
    await navigate({ to: "/login" })
  }
}
