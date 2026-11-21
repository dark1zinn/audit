import { type I18n, i18n as globalI18n } from "@lingui/core"
import { catalogs } from "./catalogs.ts"
import type { Locale } from "./locale.ts"

export { catalogs } from "./catalogs.ts"
export { detectLocale, matchLocale, type LocaleInput } from "./detect.ts"
export { DEFAULT_LOCALE, isLocale, LOCALE_NAMES, LOCALES, type Locale } from "./locale.ts"

/**
 * Loads every catalog and activates `locale` on Lingui's global instance. The web app must share it:
 * `t` from `@lingui/core/macro` (route crumbs, non-component code) always binds to the global instance.
 */
export const createI18n = (locale: Locale): I18n => {
  globalI18n.load(catalogs)
  globalI18n.activate(locale)
  return globalI18n
}
