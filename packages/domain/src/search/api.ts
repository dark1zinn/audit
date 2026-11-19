import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { CommandError } from "../errors.ts"
import { Authentication } from "../http.ts"
import {
  QuickQuery,
  RecordRecentInput,
  ReindexStatus,
  ReindexResult,
  SearchHit,
  SearchQuery,
  SearchResults,
} from "./schema.ts"

/** Full-text search with filters, quick find for the palette, and recent items. */
export const SearchApi = HttpApiGroup.make("search")
  .add(
    HttpApiEndpoint.get("search", "/api/search", {
      query: SearchQuery,
      success: SearchResults,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("quick", "/api/search/quick", {
      query: QuickQuery,
      success: Schema.Array(SearchHit),
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("reindex", "/api/search/reindex", {
      success: ReindexResult,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("reindexStatus", "/api/search/reindex", {
      success: ReindexStatus,
      error: CommandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("recordRecent", "/api/search/recent", {
      payload: RecordRecentInput,
      success: Schema.Void,
      error: CommandError,
    }),
  )
  .middleware(Authentication)
