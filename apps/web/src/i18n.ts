import { createI18n, DEFAULT_LOCALE } from "@audit/i18n"

/** The single Lingui instance for the SPA. `AppProviders` activates the resolved locale. */
export const i18n = createI18n(DEFAULT_LOCALE)
