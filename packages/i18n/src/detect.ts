import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale.ts"

/** Maps a BCP 47 tag (pt-PT, es-MX, en-GB, ...) onto a supported locale. */
export const matchLocale = (tag: string): Locale | undefined => {
  const lower = tag.toLowerCase()
  if (lower === "pt" || lower.startsWith("pt-")) return "pt-BR"
  if (lower === "es" || lower.startsWith("es-")) return "es"
  if (lower === "en" || lower.startsWith("en-")) return "en"
  return undefined
}

export interface LocaleInput {
  /** The signed-in user's saved language, if any. */
  readonly profile?: string | null | undefined
  /** `navigator.languages`, most preferred first. */
  readonly navigatorLanguages?: ReadonlyArray<string> | undefined
  /** The workspace default locale. */
  readonly workspaceDefault?: string | null | undefined
}

/**
 * Precedence: profile → browser language → workspace default → en.
 * Signed-out pages pass no profile and no workspace default.
 */
export const detectLocale = (input: LocaleInput): Locale => {
  if (isLocale(input.profile)) return input.profile
  for (const tag of input.navigatorLanguages ?? []) {
    const matched = matchLocale(tag)
    if (matched !== undefined) return matched
  }
  if (isLocale(input.workspaceDefault)) return input.workspaceDefault
  return DEFAULT_LOCALE
}
