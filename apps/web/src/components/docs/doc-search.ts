/**
 * Route search for doc pages: the template hint, and `new` to request the new-doc dialog.
 * Kept out of `docs-page.tsx` so route modules do not load the editor with it.
 */
export const docSearch = (
  search: Record<string, unknown>,
): { readonly template?: string; readonly new?: string } => ({
  ...(typeof search["template"] === "string" ? { template: search["template"] } : {}),
  ...(typeof search["new"] === "string" ? { new: search["new"] } : {}),
})
