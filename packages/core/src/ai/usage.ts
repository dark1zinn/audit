/** Token accounting: what each call used, the monthly budget guard, and the admin report. */
import { aiProviders, aiUsage, user } from "@audit/db/schema"
import { Forbidden } from "@audit/domain/errors"
import type { AiUsageReport, AiUsageRow, AiSettings } from "@audit/domain/ai/schema"
import type { AiProviderId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { and, count, eq, gte, lt, sql } from "drizzle-orm"
import { Effect } from "effect"

export type UsageFeature = typeof aiUsage.$inferInsert.feature

/** `[start, end)` of a `YYYY-MM` month in UTC. */
export const monthRange = (month: string) => {
  const [year, monthIndex] = month.split("-").map(Number)
  return {
    start: new Date(Date.UTC(year ?? 1970, (monthIndex ?? 1) - 1, 1)),
    end: new Date(Date.UTC(year ?? 1970, monthIndex ?? 1, 1)),
  }
}

export const currentMonth = (now: Date = new Date()): string =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`

const tokensSince = (userId: UserId, start: Date) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        used: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, start)))
      .pipe(Effect.orDie)
    return Number(row?.used ?? 0)
  })

/**
 * Fails before any provider call when the person has spent the workspace's monthly token budget.
 * No budget set means unlimited.
 */
export const checkBudget = (userId: UserId, settings: AiSettings) =>
  Effect.gen(function* () {
    if (settings.monthlyTokenBudget === null) return
    const { start } = monthRange(currentMonth())
    const used = yield* tokensSince(userId, start)
    if (used >= settings.monthlyTokenBudget) {
      return yield* new Forbidden({
        action: "ai.use",
        message: "AI monthly budget reached for this month",
      })
    }
  })

export interface UsageEntry {
  readonly userId: UserId | null
  readonly providerId: AiProviderId | null
  readonly feature: UsageFeature
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
}

export const recordUsage = (entry: UsageEntry) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .insert(aiUsage)
      .values({
        userId: entry.userId,
        providerId: entry.providerId,
        feature: entry.feature,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
      })
      .pipe(Effect.orDie)
  })

const totalsOf = (month: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const { start, end } = monthRange(month)
    const where = and(gte(aiUsage.createdAt, start), lt(aiUsage.createdAt, end))
    const [row] = yield* db
      .select({
        calls: count(),
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(where)
      .pipe(Effect.orDie)
    return {
      key: "total",
      label: "total",
      calls: Number(row?.calls ?? 0),
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
    } satisfies AiUsageRow
  })

/** Usage for one month: totals plus breakdowns by feature, person and provider. */
export const usageReport = (month: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const { start, end } = monthRange(month)
    const where = and(gte(aiUsage.createdAt, start), lt(aiUsage.createdAt, end))
    const totals = yield* totalsOf(month)

    const byFeature = yield* db
      .select({
        key: aiUsage.feature,
        calls: count(),
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .where(where)
      .groupBy(aiUsage.feature)
      .pipe(Effect.orDie)

    const byPerson = yield* db
      .select({
        key: aiUsage.userId,
        label: user.name,
        calls: count(),
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .leftJoin(user, eq(user.id, aiUsage.userId))
      .where(where)
      .groupBy(aiUsage.userId, user.name)
      .pipe(Effect.orDie)

    const byProvider = yield* db
      .select({
        key: aiUsage.providerId,
        label: aiProviders.name,
        calls: count(),
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      })
      .from(aiUsage)
      .leftJoin(aiProviders, eq(aiProviders.id, aiUsage.providerId))
      .where(where)
      .groupBy(aiUsage.providerId, aiProviders.name)
      .pipe(Effect.orDie)

    return {
      month,
      totals,
      byFeature: byFeature.map((row) => ({
        key: row.key,
        label: row.key,
        calls: Number(row.calls),
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
      })),
      byPerson: byPerson.map((row) => ({
        key: row.key ?? "system",
        label: row.label ?? "System",
        calls: Number(row.calls),
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
      })),
      byProvider: byProvider.map((row) => ({
        key: row.key ?? "none",
        label: row.label ?? "Removed provider",
        calls: Number(row.calls),
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
      })),
    } satisfies AiUsageReport
  })
