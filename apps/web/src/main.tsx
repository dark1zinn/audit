import "./styles.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { AppProviders } from "./components/providers.tsx"
import { createAppRouter } from "./router.tsx"

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})
const router = createAppRouter(queryClient)

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js")
  })
}

const root = document.getElementById("root")
if (root === null) throw new Error("Missing #root element")

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </QueryClientProvider>
  </StrictMode>,
)
