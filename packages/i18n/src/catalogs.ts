import { messages as en } from "./locales/en/messages.ts"
import { messages as es } from "./locales/es/messages.ts"
import { messages as ptBR } from "./locales/pt-BR/messages.ts"
import type { Locale } from "./locale.ts"

/** Compiled Lingui catalogs, keyed by locale. Shared by the web app and the server. */
export const catalogs: Record<Locale, typeof en> = { en, "pt-BR": ptBR, es }
