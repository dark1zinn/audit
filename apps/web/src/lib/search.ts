import { queryOptions } from "@tanstack/react-query"
import { useEffect } from "react"
import type { EntityId } from "@audit/domain/ids"
import type { SearchQuery } from "@audit/domain/search/schema"
import { callApi } from "./api.ts"

/** Cache keys for search; kept apart from `keys` so search stays a self-contained module. */
export const searchKeys = {
  all: ["search"] as const,
  results: (query: SearchQuery) => ["search", "results", query] as const,
  quick: (q: string) => ["search", "quick", q] as const,
}

/** Delay before a view counts as "opened"; quick open/close passes do not record a recent item. */
export const RECENT_DEBOUNCE_MS = 1500

/** Full-text results for one filter set. The page owns cursor paging. */
export const searchResultsQuery = (query: SearchQuery) =>
  queryOptions({
    queryKey: searchKeys.results(query),
    queryFn: () => callApi((api) => api.search.search({ query })),
  })

/** Palette and mention picker lookups; an empty `q` returns the caller's recent items. */
export const quickFindQuery = (q: string) =>
  queryOptions({
    queryKey: searchKeys.quick(q),
    queryFn: () => callApi((api) => api.search.quick({ query: { q } })),
    staleTime: 15_000,
  })

/**
 * Records an item as recently opened after the view has stayed mounted for a short debounce.
 * Failures are ignored: recents are a convenience, never a reason to block the view.
 */
export const useRecordRecent = (entityId: EntityId | null | undefined) => {
  useEffect(() => {
    if (entityId === null || entityId === undefined) return
    const timer = window.setTimeout(() => {
      void callApi((api) => api.search.recordRecent({ payload: { entityId } })).catch(() => {})
    }, RECENT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [entityId])
}

/** Decodes the five entities the server escapes; the snippet keeps only `<mark>` as markup. */
const decodeEntities = (text: string): string =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")

export interface SnippetPart {
  readonly text: string
  readonly mark: boolean
}

/**
 * Splits a server snippet into text and highlight parts. The server escapes all text, so the only
 * tags present are `<mark>`; the parts are safe to render as React text nodes.
 */
export const snippetParts = (snippet: string): ReadonlyArray<SnippetPart> => {
  const parts: SnippetPart[] = []
  let marked = false
  for (const piece of snippet.split(/(<\/?mark>)/)) {
    if (piece === "<mark>") marked = true
    else if (piece === "</mark>") marked = false
    else if (piece !== "") parts.push({ text: decodeEntities(piece), mark: marked })
  }
  return parts
}
