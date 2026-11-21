import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { t } from "@lingui/core/macro"
import type { Locale } from "@audit/domain/identity/schema"
import type { Me } from "@audit/domain/identity/schema"
import { callApi } from "./api.ts"
import { keys } from "./queries.ts"

export const LOCALES: ReadonlyArray<Locale> = ["en", "es", "pt-BR"]

/** Language names are shown in their own language, so they are not translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
}

/** Saves the user's language preference and refreshes the session so the UI re-renders. */
export function useChangeLocale(me: Me) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (locale: Locale) =>
      callApi((api) =>
        api.me.updateProfile({
          payload: { displayName: me.displayName, title: me.title, timezone: me.timezone, locale },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.session }),
    onError: () => toast.error(t`Could not change language`),
  })
}
