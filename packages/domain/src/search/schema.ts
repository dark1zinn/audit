import { Schema } from "effect"
import { EntityType } from "../entity.ts"
import { EntityId, ProjectId, UserId } from "../ids.ts"

/**
 * One search result. `snippet` is HTML-escaped; only `<mark>` and `</mark>` are real markup, so
 * the web client can render it as-is.
 */
export const SearchHit = Schema.Struct({
  entityId: EntityId,
  type: EntityType,
  title: Schema.String,
  snippet: Schema.String,
  url: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  updatedAt: Schema.Date,
})
export type SearchHit = typeof SearchHit.Type

export const SearchQuery = Schema.Struct({
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  /** Comma-separated entity types; omitted searches every type the caller can read. */
  types: Schema.optionalKey(Schema.String),
  projectId: Schema.optionalKey(ProjectId),
  authorId: Schema.optionalKey(UserId),
  updatedFrom: Schema.optionalKey(Schema.Date),
  updatedTo: Schema.optionalKey(Schema.Date),
  mentionsMe: Schema.optionalKey(Schema.Literals(["true", "false"])),
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(
    Schema.FiniteFromString.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
  ),
})
export type SearchQuery = typeof SearchQuery.Type

export const SearchResults = Schema.Struct({
  hits: Schema.Array(SearchHit),
  nextCursor: Schema.NullOr(Schema.String),
})
export type SearchResults = typeof SearchResults.Type

export const QuickQuery = Schema.Struct({
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
})
export type QuickQuery = typeof QuickQuery.Type

/** Returned at once: the reindex runs as a background job. */
export const ReindexResult = Schema.Struct({ queued: Schema.Literal(true) })
export type ReindexResult = typeof ReindexResult.Type

/** Latest reindex request and completion, read from the trail. */
export const ReindexStatus = Schema.Struct({
  state: Schema.Literals(["idle", "queued", "done"]),
  requestedAt: Schema.NullOr(Schema.Date),
  completedAt: Schema.NullOr(Schema.Date),
  updated: Schema.NullOr(Schema.Number),
})
export type ReindexStatus = typeof ReindexStatus.Type

export const RecordRecentInput = Schema.Struct({ entityId: EntityId })
export type RecordRecentInput = typeof RecordRecentInput.Type
