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
 * Re-checks the chain: each chained row sits at the next chain position, links to the previous row
 * and carries the hash its generation requires (legacy SHA-256 up to trail_key.legacy_through, keyed
 * HMAC after). The first remaining row is trusted as the start (retention purges remove older rows).
 * With `expectedHead`, the chain must still contain that entry, so a truncated or rewritten tail is
 * detected. Entries not yet chained are counted; an entry left unchained past the grace period means
 * the chainer is not running, which fails the check.
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
            min(chain_pos) filter (where not valid)::int as first_broken
          from (
            select chain_pos,
              (
                case when chain_pos <= (select legacy_through from trail_key where id = 1)
                  then hash = trail_event_hash(t)
                  else hash = trail_event_mac(t, ${key})
                end
              )
                and (lag(hash) over (order by chain_pos) is null
                  or prev_hash = lag(hash) over (order by chain_pos))
                and (lag(chain_pos) over (order by chain_pos) is null
                  or chain_pos = lag(chain_pos) over (order by chain_pos) + 1)
                as valid
            from trail_events t
            where chain_pos is not null
          ) chain`,
      )
      .pipe(Effect.orDie)
    const head = yield* db
      .execute<{ chain_pos: number; hash: string }>(
        sql`select chain_pos::int as chain_pos, hash from trail_events
          where chain_pos is not null order by chain_pos desc limit 1`,
      )
      .pipe(Effect.orDie)
    let expectedHeadFound: boolean | null = null
    if (options.expectedHead !== undefined) {
      const found = yield* db
        .execute<{ found: boolean }>(
          sql`select exists(
            select 1 from trail_events
            where chain_pos = ${options.expectedHead.chainPos} and hash = ${options.expectedHead.hash}
          ) as found`,
        )
        .pipe(Effect.orDie)
      expectedHeadFound = found.rows[0]?.found === true
    }
    const counts = yield* db
      .execute<{ pending: number; overdue: number }>(
        sql`select count(*) filter (where chain_pos is null)::int as pending,
            count(*) filter (where chain_pos is null and at < now() - interval '60 seconds')::int as overdue
          from trail_events`,
      )
      .pipe(Effect.orDie)
    const start = yield* db
      .execute<{ chain_pos: number; prev_hash: string | null }>(
        sql`select chain_pos::int as chain_pos, prev_hash from trail_events
          where chain_pos is not null order by chain_pos limit 1`,
      )
      .pipe(Effect.orDie)
    const anchor = yield* db
      .execute<{ kept_pos: number; kept_prev_hash: string | null }>(
        sql`select kept_pos::int as kept_pos, kept_prev_hash from trail_anchor`,
      )
      .pipe(Effect.orDie)
    // The chain begins where the latest purge left it; with no purge, the first entry is position 1.
    const first = start.rows[0]
    const anchored = anchor.rows[0]
    const startValid =
      first === undefined ||
      (anchored === undefined
        ? first.chain_pos === 1 && first.prev_hash === null
        : first.chain_pos === anchored.kept_pos && first.prev_hash === anchored.kept_prev_hash)
    const row = result.rows[0]
    const firstBrokenPos = startValid ? (row?.first_broken ?? null) : (first?.chain_pos ?? null)
    const current = head.rows[0]
    const counted = counts.rows[0]
    const overdue = counted?.overdue ?? 0
    return {
      ok: firstBrokenPos === null && expectedHeadFound !== false && overdue === 0,
      checked: row?.checked ?? 0,
      pending: counted?.pending ?? 0,
      overdue,
      firstBrokenPos,
      head: current === undefined ? null : { chainPos: current.chain_pos, hash: current.hash },
      expectedHeadFound,
    } satisfies TrailVerification
  })
