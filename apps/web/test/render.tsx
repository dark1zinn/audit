import { I18nProvider } from "@lingui/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { createI18n } from "@audit/i18n"
import { TooltipProvider } from "@audit/ui/components/ui/tooltip.tsx"
import { ThemeProvider } from "@audit/ui/theme.tsx"

export interface RenderOptions {
  /** Initial location for the memory router. */
  readonly route?: string
  /** Seeds the fresh query client, e.g. `qc.setQueryData(...)`, so no network call is made. */
  readonly seed?: (queryClient: QueryClient) => void
}

/**
 * Renders `ui` inside the same provider stack as the app: en catalog, a fresh query client,
 * tooltips, theme and a memory-history router whose root route renders `ui`.
 */
export async function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  options.seed?.(queryClient)
  const i18n = createI18n("en")
  const rootRoute = createRootRoute({ component: () => ui })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [options.route ?? "/"] }),
  })
  await router.load()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <I18nProvider i18n={i18n}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return { ...result, queryClient, router }
}
