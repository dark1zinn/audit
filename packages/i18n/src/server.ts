import { type I18n, type MessageDescriptor, setupI18n, type Values } from "@lingui/core"
import { catalogs } from "./catalogs.ts"
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale.ts"

const instances = new Map<Locale, I18n>()

const instanceFor = (locale: Locale): I18n => {
  const cached = instances.get(locale)
  if (cached !== undefined) return cached
  const i18n = setupI18n()
  i18n.load(catalogs)
  i18n.activate(locale)
  instances.set(locale, i18n)
  return i18n
}

/**
 * Translates a server-side message. Unknown locales fall back to the default locale.
 * Descriptors use the same ids as the web catalogs (`{ id, message }`).
 */
export const translate = (
  locale: string | null | undefined,
  descriptor: MessageDescriptor,
  values?: Values,
): string => {
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE
  const withValues: MessageDescriptor =
    values === undefined ? descriptor : { ...descriptor, values }
  return instanceFor(resolved)._(withValues)
}
