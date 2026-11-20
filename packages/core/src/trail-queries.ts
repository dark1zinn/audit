import { trailEvents, userProfiles } from "@audit/db/schema"
import type { EntityId, ProjectId, TrailEventId, UserId } from "@audit/domain/ids"
import type {
  TrailDiff,
  TrailEvent,
  TrailFilter,
  TrailHead,
  TrailMeta,
  TrailPage,
  TrailVerification,
} from "@audit/domain/trail/schema"
import { Db } from "@audit/platform/database"
import { and, desc, eq, gte, lt, lte, type SQL, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "./authz.ts"
import { loadTrailKey } from "./trail-key.ts"

const DEFAULT_LIMIT = 50

const toEvent = (
  row: typeof trailEvents.$inferSelect & { readonly actorName: string | null },
): TrailEvent => ({
  id: row.id as TrailEventId,
  seq: row.seq,
  at: row.at,
  actorType: row.actorType,
  actorId: row.actorId as UserId | null,
  actorName: row.actorName,
  onBehalfOf: row.onBehalfOf as UserId | null,
  action: row.action,
  entityId: row.entityId as EntityId | null,
  entityType: row.entityType,
  projectId: row.projectId as ProjectId | null,
  diff: row.diff as TrailDiff | null,
  meta: row.meta as TrailMeta,
})

/** Newest first, filtered; admins and owners only. */
export const listTrail = (filter: TrailFilter) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("trail.read")
    const db = yield* Db
    const limit = filter.limit ?? DEFAULT_LIMIT
    const conditions: Array<SQL> = []
    if (filter.actorId !== undefined) {
      conditions.push(
        sql`(${trailEvents.actorId} = ${filter.actorId} or ${trailEvents.onBehalfOf} = ${filter.actorId})`,
      )
    }
    if (filter.action !== undefined) {
      conditions.push(
        sql`${trailEvents.action} like ${`${filter.action.replace(/[%_]/g, "\\$&")}%`}`,
      )
    }
    if (filter.entityId !== undefined) conditions.push(eq(trailEvents.entityId, filter.entityId))
    if (filter.projectId !== undefined) conditions.push(eq(trailEvents.projectId, filter.projectId))
    if (filter.from !== undefined) conditions.push(gte(trailEvents.at, filter.from))
    if (filter.to !== undefined) conditions.push(lte(trailEvents.at, filter.to))
    if (filter.before !== undefined) conditions.push(lt(trailEvents.seq, filter.before))
    const rows = yield* db
      .select({ event: trailEvents, actorName: userProfiles.displayName })
      .from(trailEvents)
      .leftJoin(
        userProfiles,
        sql`${userProfiles.userId} = coalesce(${trailEvents.actorId}, ${trailEvents.onBehalfOf})`,
      )
      .where(and(...conditions))
      .orderBy(desc(trailEvents.seq))
      .limit(limit + 1)
      .pipe(Effect.orDie)
    const page = rows.slice(0, limit).map((r) => toEvent({ ...r.event, actorName: r.actorName }))
    return {
      events: page,
      nextBefore: rows.length > limit ? (page.at(-1)?.seq ?? null) : null,
    } satisfies TrailPage
  })

/**
 * Re-checks the trail: each row links to the previous one and carries the hash its generation
 * requires (legacy SHA-256 up to trail_key.legacy_through, keyed HMAC after). The first remaining
 * row is trusted as the start (retention purges remove older rows). With `expectedHead`, the trail
 * must still contain that entry, so a truncated or rewritten tail is detected.
 */
export const verifyTrail = (options: { readonly expectedHead?: TrailHead } = {}) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("trail.read")
    const db = yield* Db
    const key = yield* loadTrailKey
    const result = yield* db
      .execute<{ checked: number; first_broken: number | null }>(
        sql`
          select count(*)::int as checked,
            min(seq) filter (where not valid)::int as first_broken
          from (
            select seq,
              (
                case when seq <= (select legacy_through from trail_key where id = 1)
                  then hash = trail_event_hash(t)
                  else hash = trail_event_mac(t, ${key})
                end
              )
                and (lag(hash) over (order by seq) is null or prev_hash = lag(hash) over (order by seq))
                as valid
            from trail_events t
          ) chain`,
      )
      .pipe(Effect.orDie)
    const head = yield* db
      .execute<{ seq: number; hash: string }>(
        sql`select seq::int as seq, hash from trail_events order by seq desc limit 1`,
      )
      .pipe(Effect.orDie)
    let expectedHeadFound: boolean | null = null
    if (options.expectedHead !== undefined) {
      const found = yield* db
        .execute<{ found: boolean }>(
          sql`select exists(
            select 1 from trail_events where seq = ${options.expectedHead.seq} and hash = ${options.expectedHead.hash}
          ) as found`,
        )
        .pipe(Effect.orDie)
      expectedHeadFound = found.rows[0]?.found === true
    }
    const row = result.rows[0]
    const firstBrokenSeq = row?.first_broken ?? null
    const current = head.rows[0]
    return {
      ok: firstBrokenSeq === null && expectedHeadFound !== false,
      checked: row?.checked ?? 0,
      firstBrokenSeq,
      head: current === undefined ? null : { seq: current.seq, hash: current.hash },
      expectedHeadFound,
    } satisfies TrailVerification
  })
