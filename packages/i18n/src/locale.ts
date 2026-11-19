export const LOCALES = ["en", "pt-BR", "es"] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "en"

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as ReadonlyArray<string>).includes(value)

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
}
