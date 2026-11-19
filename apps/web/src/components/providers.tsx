import { I18nProvider } from "@lingui/react"
import { useQuery } from "@tanstack/react-query"
import { detectLocale } from "@audit/i18n"
import { Toaster } from "@audit/ui/components/ui/sonner.tsx"
import { ThemeProvider } from "@audit/ui/theme.tsx"
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { i18n } from "../i18n.ts"
import { sessionQuery } from "../lib/queries.ts"

const PSEUDO_LOCALE = "pseudo"
const PSEUDO_STORAGE_KEY = "audit.pseudo"

/**
 * Dev-only pseudo-locale switch: `?pseudo=1` turns it on and `?pseudo=0` turns it off; the choice
 * persists in localStorage. The catalog loads on demand, so production never fetches it.
 */
function usePseudoLocale(): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const param = new URLSearchParams(window.location.search).get("pseudo")
    if (param === "1") localStorage.setItem(PSEUDO_STORAGE_KEY, "1")
    if (param === "0") localStorage.removeItem(PSEUDO_STORAGE_KEY)
    if (localStorage.getItem(PSEUDO_STORAGE_KEY) !== "1") return
    void import("@audit/i18n/pseudo").then(({ messages }) => {
      i18n.load(PSEUDO_LOCALE, messages)
      setEnabled(true)
    })
  }, [])

  return enabled
}

/** Applies workspace theme/accent/locale once the session is known; defaults until then. */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  const session = useQuery(sessionQuery)
  const me = session.data ?? null
  const pseudo = usePseudoLocale()

  const locale = detectLocale({
    profile: me?.locale ?? null,
    navigatorLanguages: navigator.languages,
    workspaceDefault: me?.workspace.defaultLocale ?? null,
  })

  useLayoutEffect(() => {
    i18n.activate(pseudo ? PSEUDO_LOCALE : locale)
    document.documentElement.lang = locale
  }, [locale, pseudo])

  return (
    <ThemeProvider
      defaultTheme={me?.workspace.defaultTheme ?? "system"}
      accentColor={me?.workspace.accentColor}
    >
      <I18nProvider i18n={i18n}>
        {children}
        <Toaster />
      </I18nProvider>
    </ThemeProvider>
  )
}
