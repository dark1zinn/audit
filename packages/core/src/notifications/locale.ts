import { userProfiles, workspace } from "@audit/db/schema"
import { Locale } from "@audit/domain/identity/schema"
import type { UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

/** Workspace default locale; English when the workspace row or setting is missing. */
export const workspaceLocale = Effect.gen(function* () {
  const db = yield* Db
  const [row] = yield* db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, 1))
    .pipe(Effect.orDie)
  const raw = typeof row?.settings === "object" && row.settings !== null ? row.settings : {}
  const defaultLocale = "defaultLocale" in raw ? raw.defaultLocale : undefined
  return Schema.is(Locale)(defaultLocale) ? defaultLocale : ("en" as const)
})

/** Profile locale, then the workspace default, then English. */
export const recipientLocale = (userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [profile] = yield* db
      .select({ locale: userProfiles.locale })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .pipe(Effect.orDie)
    if (profile !== undefined && Schema.is(Locale)(profile.locale)) return profile.locale
    return yield* workspaceLocale
  })
