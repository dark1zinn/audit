/**
 * Route search for doc pages: the template hint, `new` to request the new-doc dialog, and `split`
 * for the doc shown beside the main one. Kept out of `docs-page.tsx` so route modules do not load
 * the editor with it.
 */
export const docSearch = (
  search: Record<string, unknown>,
): {
  readonly template?: string | undefined
  readonly new?: string | undefined
  readonly split?: string | undefined
} => ({
  ...(typeof search["template"] === "string" ? { template: search["template"] } : {}),
  ...(typeof search["new"] === "string" ? { new: search["new"] } : {}),
  ...(typeof search["split"] === "string" ? { split: search["split"] } : {}),
})
