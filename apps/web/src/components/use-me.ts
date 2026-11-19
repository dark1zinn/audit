import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import type { Me } from "@audit/domain/identity/schema"
import { sessionQuery } from "../lib/queries.ts"

const appRoute = getRouteApi("/_app")

/** The signed-in user, kept fresh by the session query. Only valid under `_app`. */
export function useMe(): Me {
  const { me } = appRoute.useRouteContext()
  return useQuery(sessionQuery).data ?? me
}
