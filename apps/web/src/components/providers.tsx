import { I18nProvider } from "@lingui/react"
import { useQuery } from "@tanstack/react-query"
import { detectLocale } from "@audit/i18n"
import { Toaster } from "@audit/ui/components/ui/sonner.tsx"
import { ThemeProvider } from "@audit/ui/theme.tsx"
import { useLayoutEffect, type ReactNode } from "react"
import { i18n } from "../i18n.ts"
import { sessionQuery } from "../lib/queries.ts"

/** Applies workspace theme/accent/locale once the session is known; defaults until then. */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  const session = useQuery(sessionQuery)
  const me = session.data ?? null

  const locale = detectLocale({
    profile: me?.locale ?? null,
    navigatorLanguages: navigator.languages,
    workspaceDefault: me?.workspace.defaultLocale ?? null,
  })

  useLayoutEffect(() => {
    i18n.activate(locale)
    document.documentElement.lang = locale
  }, [locale])

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
