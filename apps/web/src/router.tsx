import type { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen.ts"

export const createAppRouter = (queryClient: QueryClient) =>
  createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
  })

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
