/**
 * Retrieval over embedded chunks. Full-text and vector candidates are both filtered by
 * `authz.visible` before ranking, so nothing the actor cannot see reaches the ranking or the
 * output. The two lists are fused with reciprocal rank fusion. Without a usable embedding model
 * (AI off, `semantic_search` off, or the provider failing) the result is full-text only.
 */
import type { RetrievalScope, RetrievedChunk } from "@audit/domain/ai/retrieval"
import { CurrentActor } from "@audit/domain/actor"
import type { EntityId, ProjectId } from "@audit/domain/ids"
import type { EntityType } from "@audit/domain/entity"
import { Db } from "@audit/platform/database"
import { type SQL, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { rrf } from "./chunk.ts"
import { currentEmbeddingModel, embedTexts } from "./embeddings.ts"
import type { Secrets } from "@audit/platform/crypto"
import type { AiModels } from "./models.ts"
import { INDEXABLE_TYPES } from "./sources.ts"

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 12
/** Candidates kept from each ranking before fusion. */
const POOL = 50

export interface RetrieveOptions {
  readonly limit?: number
}

interface CandidateRow {
  readonly entity_id: string
  readonly type: EntityType
  readonly title: string
  readonly chunk: number
  readonly text: string
  readonly project_id: string | null
  readonly project_key: string | null
  readonly task_number: number | null
  readonly channel_id: string | null
}

interface Ranked {
  readonly row: CandidateRow
  readonly score: number
}

const inList = (values: ReadonlyArray<string>): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )

const scopeWhere = (scope: RetrievalScope): SQL => {
  const parts: SQL[] = [sql`e.type in (${inList(INDEXABLE_TYPES)})`]
  if (scope.projectId !== undefined) parts.push(sql`e.project_id = ${scope.projectId}`)
  if (scope.types !== undefined && scope.types.length > 0) {
    parts.push(sql`e.type in (${inList(scope.types)})`)
  }
  return sql.join(parts, sql` and `)
}

/** Same link shape the search hits use. */
const urlFor = (row: CandidateRow): string => {
  if (row.type === "task" && row.project_key !== null)
    return `/p/${row.project_key}/t/${row.task_number ?? ""}`
  if (row.type === "doc")
    return row.project_key !== null
      ? `/p/${row.project_key}/docs/${row.entity_id}`
      : `/docs/${row.entity_id}`
  if (row.type === "message" && row.channel_id !== null) return `/c/${row.channel_id}`
  if (row.type === "event") return "/calendar"
  return "/"
}

const keyOf = (row: CandidateRow) => `${row.entity_id}:${row.chunk}`

/**
 * Visible candidates ranked best first. Fused with RRF when vectors are usable, otherwise the
 * full-text order. Never fails on the semantic side: a provider error falls back to full text.
 */
const candidates = (query: string, scope: RetrievalScope) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const visible = yield* authz.visible(sql`e.id`)
    const where = sql.join([sql`e.deleted_at is null`, scopeWhere(scope), visible], sql` and `)
    const columns = sql`
      e.id as entity_id, e.type, e.title, c.chunk, c.text, e.project_id,
      p.key as project_key, t.number as task_number, m.channel_id
      from embeddings c
      join entities e on e.id = c.entity_id
      left join projects p on p.id = e.project_id
      left join tasks t on t.id = e.id
      left join messages m on m.id = e.id`
    const tsvector = sql`to_tsvector(audit_search_config(), c.text)`
    const tsquery = sql`plainto_tsquery(audit_search_config(), ${query})`

    const fts = yield* db
      .execute<CandidateRow>(sql`select ${columns}
        where ${where} and ${tsvector} @@ ${tsquery}
        order by ts_rank_cd(${tsvector}, ${tsquery}) desc, e.id, c.chunk
        limit ${POOL}`)
      .pipe(
        Effect.map((result) => result.rows),
        Effect.orDie,
      )
    const ftsOnly = (): ReadonlyArray<Ranked> =>
      fts.map((row, index) => ({ row, score: 1 / (index + 1) }))

    const model = yield* currentEmbeddingModel
    if (model === null) return ftsOnly()
    const embedded = yield* embedTexts([query]).pipe(Effect.catch(() => Effect.succeed(null)))
    if (embedded === null) return ftsOnly()
    const queryVector = embedded.vectors[0]
    if (queryVector === undefined) return ftsOnly()

    const vectorRows = yield* db
      .execute<CandidateRow>(sql`select ${columns}
        where ${where} and c.vector is not null and c.model = ${embedded.model}
        order by c.vector <=> ${`[${queryVector.join(",")}]`}::halfvec, e.id, c.chunk
        limit ${POOL}`)
      .pipe(
        Effect.map((result) => result.rows),
        Effect.orDie,
      )

    const byKey = new Map<string, CandidateRow>()
    for (const row of [...fts, ...vectorRows]) byKey.set(keyOf(row), row)
    return rrf([fts.map(keyOf), vectorRows.map(keyOf)]).flatMap(({ key, score }) => {
      const row = byKey.get(key)
      return row === undefined ? [] : [{ row, score }]
    })
  })

/** Chunks the actor may see that best match `query`, most relevant first. */
export const retrieveContext = (
  query: string,
  scope: RetrievalScope,
  options: RetrieveOptions = {},
): Effect.Effect<
  ReadonlyArray<RetrievedChunk>,
  never,
  Db | Authz | CurrentActor | Secrets | AiModels
> =>
  Effect.gen(function* () {
    const trimmed = query.trim()
    if (trimmed === "") return []
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const ranked = yield* candidates(trimmed, scope)
    return ranked.slice(0, limit).map(({ row, score }) => ({
      entityId: row.entity_id as EntityId,
      type: row.type,
      title: row.title,
      chunk: row.chunk,
      text: row.text,
      url: urlFor(row),
      projectId: row.project_id as ProjectId | null,
      score,
    }))
  })

/** Visible entity ids in relevance order, for merging semantic hits into search results. */
export const semanticEntityIds = (
  query: string,
  scope: RetrievalScope,
): Effect.Effect<ReadonlyArray<string>, never, Db | Authz | CurrentActor | Secrets | AiModels> =>
  Effect.gen(function* () {
    const trimmed = query.trim()
    if (trimmed === "") return []
    const model = yield* currentEmbeddingModel
    if (model === null) return []
    const ranked = yield* candidates(trimmed, scope)
    return [...new Set(ranked.map(({ row }) => row.entity_id))]
  })
