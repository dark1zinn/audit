import { type I18n, setupI18n } from "@lingui/core"
import { catalogs } from "./catalogs.ts"
import type { Locale } from "./locale.ts"

export { catalogs } from "./catalogs.ts"
export { detectLocale, matchLocale, type LocaleInput } from "./detect.ts"
export { DEFAULT_LOCALE, isLocale, LOCALE_NAMES, LOCALES, type Locale } from "./locale.ts"

/** Creates an isolated Lingui instance with every catalog loaded and `locale` active. */
export const createI18n = (locale: Locale): I18n => {
  const i18n = setupI18n()
  i18n.load(catalogs)
  i18n.activate(locale)
  return i18n
}
