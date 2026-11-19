/** Workspace AI administration reads: settings, provider accounts and token usage. */
import { aiProviders } from "@audit/db/schema"
import { ValidationError } from "@audit/domain/errors"
import { Db } from "@audit/platform/database"
import { asc } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { readAiSettings } from "./settings.ts"
import { toProviderView } from "./providers.ts"
import { currentMonth, usageReport } from "./usage.ts"

const requireConfigure = Effect.gen(function* () {
  const authz = yield* Authz
  yield* authz.requireCapability("ai.configure")
})

export const aiSettings = Effect.gen(function* () {
  yield* requireConfigure
  return yield* readAiSettings
})

export const providerList = Effect.gen(function* () {
  yield* requireConfigure
  const db = yield* Db
  const rows = yield* db
    .select()
    .from(aiProviders)
    .orderBy(asc(aiProviders.name))
    .pipe(Effect.orDie)
  return rows.map(toProviderView)
})

/** Usage for `month` (`YYYY-MM`, UTC); defaults to the current month. */
export const aiUsage = (month?: string) =>
  Effect.gen(function* () {
    yield* requireConfigure
    const selected = month ?? currentMonth()
    if (!/^\d{4}-\d{2}$/.test(selected)) {
      return yield* new ValidationError({ message: "Month must be YYYY-MM" })
    }
    return yield* usageReport(selected)
  })
