/**
 * Search reads. Visibility is a WHERE condition (`authz.visible`) so restricted items, deleted
 * items and private channel messages never reach ranking, snippets or counts. Snippets are built
 * by `ts_headline` on the limited hit set only; the HTML escaping happens here, so the client
 * only ever receives `<mark>` as markup.
 */
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import type { EntityType } from "@audit/domain/entity"
import type { EntityId, ProjectId } from "@audit/domain/ids"
import { QuickQuery, SearchHit, SearchQuery, SearchResults } from "@audit/domain/search/schema"
import { Db } from "@audit/platform/database"
import { type SQL, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { rrf } from "../ai/chunk.ts"
import { semanticEntityIds } from "../ai/retrieval.ts"

const MARK_START = "\u0001"
const MARK_END = "\u0002"
const HEADLINE = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxFragments=1, MaxWords=24, MinWords=5`
const QUICK_LIMIT = 20
const RECENT_LIMIT = 10

interface HitRow {
  readonly id: string
  readonly type: EntityType
  readonly title: string
  readonly project_id: string | null
  readonly updated_at: Date
  readonly snippet: string | null
  readonly url: string
}

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

/** Escapes everything, then turns the private start/stop markers into `<mark>`. */
const highlight = (snippet: string) =>
  escapeHtml(snippet).replaceAll(MARK_START, "<mark>").replaceAll(MARK_END, "</mark>")

const toHit = (row: HitRow): SearchHit => ({
  entityId: row.id as EntityId,
  type: row.type,
  title: row.title,
  snippet: highlight(row.snippet ?? ""),
  url: row.url,
  projectId: row.project_id as ProjectId | null,
  updatedAt: new Date(row.updated_at),
})

/** Escapes LIKE wildcards so the user's text matches literally. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, "\\$&")

/** Navigation target per entity type; the join aliases come from `hitJoins`. */
const hitUrl = sql`(case m.type
  when 'task' then '/p/' || p.key || '/t/' || t.number
  when 'doc' then case when p.key is null then '/docs/' || m.id else '/p/' || p.key || '/docs/' || m.id end
  when 'project' then '/p/' || own.key
  when 'channel' then '/c/' || m.id
  when 'message' then '/c/' || ms.channel_id
  when 'event' then '/calendar'
  else '/'
end)`

/** Joins for the navigation target; every hit query selects from an alias `m` and uses these. */
const hitJoins = sql`
  left join tasks t on t.id = m.id
  left join projects p on p.id = m.project_id
  left join projects own on own.id = m.id
  left join messages ms on ms.id = m.id`

/** Hit columns; `snippet` is raw (unescaped) text. */
const hitColumns = (snippet: SQL) =>
  sql`m.id, m.type, m.title, m.project_id, m.updated_at, ${snippet} as snippet, ${hitUrl} as url`

/** Last ranked row of the previous page, as exact text so the keyset round-trips losslessly. */
interface Keyset {
  readonly rank: string
  readonly updated: string
  readonly id: string
}

interface CursorState {
  readonly mode: "fts" | "trgm" | "fused"
  readonly keyset: Keyset | null
  readonly offset: number
}

/** Lexical candidates fed into the fused ranking. */
const FUSED_POOL = 200

const encodeCursor = (mode: "fts" | "trgm", keyset: Keyset) =>
  Buffer.from(JSON.stringify({ mode, ...keyset })).toString("base64url")

/** Fused pages are addressed by offset: the merged order is recomputed on each page. */
const encodeFusedCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ mode: "fused", offset })).toString("base64url")

const decodeCursor = (cursor: string | undefined): CursorState => {
  const start: CursorState = { mode: "fts", keyset: null, offset: 0 }
  if (cursor === undefined) return start
  try {
    const raw = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>
    if (raw.mode === "fused" && typeof raw.offset === "number")
      return { mode: "fused", keyset: null, offset: raw.offset }
    const { rank, updated, id } = raw
    if (typeof rank !== "string" || typeof updated !== "string" || typeof id !== "string")
      return start
    return {
      mode: raw.mode === "trgm" ? "trgm" : "fts",
      keyset: { rank, updated, id },
      offset: 0,
    }
  } catch {
    return start
  }
}

/** One ranked candidate plus its visibility; the window keeps invisible rows so keysets advance. */
interface WindowRow {
  readonly id: string
  readonly type: EntityType
  readonly title: string
  readonly project_id: string | null
  readonly updated_at: Date
  readonly rank_text: string
  readonly updated_text: string
  readonly visible_flag: number
}

interface MatchSpec {
  readonly match: SQL
  readonly rank: SQL
}

/** Candidate windows start at 200 rows and double, capped, until the page fills or runs out. */
const WINDOW_START = 200
const WINDOW_MAX = 3200

/** Strictly after `keyset` in the order rank desc, updated_at desc, id asc. */
const afterKeyset = (rank: SQL, keyset: Keyset | null): SQL =>
  keyset === null
    ? sql`true`
    : sql`((${rank}) < ${keyset.rank}::real
        or ((${rank}) = ${keyset.rank}::real and (
          e.updated_at < ${keyset.updated}::timestamptz
          or (e.updated_at = ${keyset.updated}::timestamptz and e.id > ${keyset.id}))))`

/** Full-text search with filters. Title hits rank above body hits through the tsvector weights. */
const searchEntities = (query: SearchQuery) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const actor = yield* CurrentActor
    const visibleC = yield* authz.visible(sql`c.id`)
    const visibleE = yield* authz.visible(sql`e.id`)
    const q = (query.q ?? "").trim()
    const limit = query.limit ?? 20
    const cursor = decodeCursor(query.cursor)

    // Visibility is applied per window (see `windowRows`), never to the whole match set.
    const conditions: SQL[] = [sql`e.deleted_at is null`]
    if (query.types !== undefined) {
      const types = query.types
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== "")
      if (types.length > 0)
        conditions.push(
          sql`e.type in (${sql.join(
            types.map((t) => sql`${t}`),
            sql`, `,
          )})`,
        )
    }
    if (query.projectId !== undefined) conditions.push(sql`e.project_id = ${query.projectId}`)
    if (query.authorId !== undefined) conditions.push(sql`e.created_by = ${query.authorId}`)
    if (query.updatedFrom !== undefined) conditions.push(sql`e.updated_at >= ${query.updatedFrom}`)
    if (query.updatedTo !== undefined) conditions.push(sql`e.updated_at <= ${query.updatedTo}`)
    const userId = actorUserId(actor)
    if (query.mentionsMe === "true" && userId !== null) {
      conditions.push(sql`exists (
        select 1 from "references" r
        where r.source_id = e.id and r.target_id = ${userId} and r.kind = 'mention')`)
    }

    /** Ranked candidate window after the keyset; only id, rank and visibility leave the query. */
    const windowRows = (spec: MatchSpec, keyset: Keyset | null, size: number) =>
      db
        .execute<WindowRow>(sql`
          with cand as (
            select e.id, e.type, e.title, e.project_id, e.updated_at, ${spec.rank} as rank
            from entities e
            cross join (select plainto_tsquery(audit_search_config(), ${q}) as tsq) qq
            where ${sql.join([...conditions, spec.match, afterKeyset(spec.rank, keyset)], sql` and `)}
            order by rank desc, e.updated_at desc, e.id
            limit ${size}
          )
          select c.id, c.type, c.title, c.project_id, c.updated_at,
            c.rank::text as rank_text, c.updated_at::text as updated_text,
            case when ${visibleC} then 1 else 0 end as visible_flag
          from cand c
          order by c.rank desc, c.updated_at desc, c.id`)
        .pipe(
          Effect.map((result) => result.rows),
          Effect.orDie,
        )

    /** Walks windows until `need` visible rows are found or candidates run out. */
    const collect = (spec: MatchSpec, start: Keyset | null, need: number) =>
      Effect.gen(function* () {
        const visibleRows: WindowRow[] = []
        let keyset = start
        let size = WINDOW_START
        for (;;) {
          const window = yield* windowRows(spec, keyset, size)
          for (const row of window) {
            if (row.visible_flag !== 1) continue
            visibleRows.push(row)
            if (visibleRows.length >= need) return visibleRows
          }
          const last = window.at(-1)
          if (window.length < size || last === undefined) return visibleRows
          keyset = { rank: last.rank_text, updated: last.updated_text, id: last.id }
          size = Math.min(size * 2, WINDOW_MAX)
        }
      })

    const ftsSpec: MatchSpec = {
      match: sql`qq.tsq @@ e.search`,
      rank: sql`ts_rank_cd(e.search, qq.tsq)`,
    }
    const trgmSpec: MatchSpec = { match: sql`e.title % ${q}`, rank: sql`similarity(e.title, ${q})` }
    const need = limit + 1

    const snippet =
      q === ""
        ? sql`''`
        : sql`ts_headline(audit_search_config(), m.title || ' ' || m.search_text, plainto_tsquery(audit_search_config(), ${q}), ${HEADLINE})`

    /** Hit rows for `ids`, in the order given; ids that no longer resolve are dropped. */
    const hydrate = (ids: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        if (ids.length === 0) return []
        const result = yield* db
          .execute<HitRow>(sql`
            select ${hitColumns(snippet)}
            from entities m
            ${hitJoins}
            where m.id in (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`)
          .pipe(Effect.orDie)
        const byId = new Map(result.rows.map((row) => [row.id, row]))
        return ids.flatMap((id) => {
          const hit = byId.get(id)
          return hit === undefined ? [] : [toHit(hit)]
        })
      })

    /** The ids that pass the filters and are visible to the actor. */
    const allowedIds = (ids: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        if (ids.length === 0) return new Set<string>()
        const result = yield* db
          .execute<{ id: string }>(sql`
            select e.id from entities e
            where e.id in (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )}) and ${sql.join([...conditions, visibleE], sql` and `)}`)
          .pipe(Effect.orDie)
        return new Set(result.rows.map((row) => row.id))
      })

    let semanticIds: ReadonlyArray<string> = []
    if (q !== "" && cursor.mode !== "trgm") semanticIds = yield* semanticEntityIds(q, {})

    if (q !== "" && (cursor.mode === "fused" || semanticIds.length > 0)) {
      // Lexical and semantic rankings fused by reciprocal rank; the page is cut from the fused list.
      const lexical = yield* collect(ftsSpec, null, FUSED_POOL)
      const fused = rrf([lexical.map((row) => row.id), [...semanticIds]]).map((item) => item.key)
      const passing = yield* allowedIds(fused)
      const ordered = fused.filter((id) => passing.has(id))
      const start = cursor.offset
      return {
        hits: yield* hydrate(ordered.slice(start, start + limit)),
        nextCursor: ordered.length > start + limit ? encodeFusedCursor(start + limit) : null,
      } satisfies SearchResults
    }

    let mode: "fts" | "trgm" = cursor.mode === "trgm" ? "trgm" : "fts"
    let visibleRows: ReadonlyArray<WindowRow>
    if (q === "") {
      visibleRows = yield* collect({ match: sql`true`, rank: sql`0` }, cursor.keyset, need)
    } else if (mode === "fts") {
      visibleRows = yield* collect(ftsSpec, cursor.keyset, need)
      if (visibleRows.length === 0 && cursor.keyset === null) {
        mode = "trgm"
        visibleRows = yield* collect(trgmSpec, null, need)
      }
    } else {
      visibleRows = yield* collect(trgmSpec, cursor.keyset, need)
    }

    const pageRows = visibleRows.slice(0, limit)
    const hits = yield* hydrate(pageRows.map((row) => row.id))
    const last = visibleRows[limit - 1]
    return {
      hits,
      nextCursor:
        visibleRows.length > limit && last !== undefined
          ? encodeCursor(mode, { rank: last.rank_text, updated: last.updated_text, id: last.id })
          : null,
    } satisfies SearchResults
  })

/** Palette results. Empty query lists recent items; otherwise task keys first, then titles. */
const quickFind = (query: QuickQuery) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const actor = yield* CurrentActor
    const userId = actorUserId(actor)
    const visible = yield* authz.visible(sql`m.id`)
    const q = (query.q ?? "").trim()

    if (q === "") {
      if (userId === null) return [] as ReadonlyArray<SearchHit>
      const result = yield* db
        .execute<HitRow>(sql`
          select ${hitColumns(sql`''`)}
          from recent_items ri
          join entities m on m.id = ri.entity_id
          ${hitJoins}
          where ri.user_id = ${userId} and m.deleted_at is null and ${visible}
          order by ri.viewed_at desc
          limit ${RECENT_LIMIT}`)
        .pipe(Effect.orDie)
      return result.rows.map(toHit)
    }

    const prefix = `${likeEscape(q)}%`
    const contains = `%${likeEscape(q)}%`
    const keyRows = yield* db
      .execute<HitRow>(sql`
        select ${hitColumns(sql`''`)}
        from entities m
        ${hitJoins}
        where t.id is not null and m.deleted_at is null and ${visible}
          and (p.key || '-' || t.number) ilike ${prefix}
        order by t.number
        limit ${QUICK_LIMIT}`)
      .pipe(Effect.orDie)
    const titleRows = yield* db
      .execute<HitRow>(sql`
        select ${hitColumns(sql`''`)}
        from entities m
        ${hitJoins}
        where m.deleted_at is null and ${visible}
          and (m.title ilike ${contains} or m.title % ${q})
        order by (m.title ilike ${prefix}) desc, similarity(m.title, ${q}) desc, m.title
        limit ${QUICK_LIMIT}`)
      .pipe(Effect.orDie)

    const seen = new Set<string>()
    const hits: SearchHit[] = []
    for (const row of [...keyRows.rows, ...titleRows.rows]) {
      if (seen.has(row.id) || hits.length >= QUICK_LIMIT) continue
      seen.add(row.id)
      hits.push(toHit(row))
    }
    return hits
  })

/** Full-text search across every entity the caller can see, with highlighted snippets. */
export const search = Command.make("search.query", {
  input: SearchQuery,
  output: SearchResults,
  authorize: () => Effect.void,
  run: searchEntities,
})

/** Palette results: recent items for an empty query, otherwise key and title matches. */
export const quick = Command.make("search.quick", {
  input: QuickQuery,
  output: Schema.Array(SearchHit),
  authorize: () => Effect.void,
  run: quickFind,
})
