import { join, normalize, sep } from "node:path"

export type StaticPath =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "outside" }
  | { readonly kind: "malformed" }

/**
 * Maps a URL path to a file under `webRoot`. A sibling directory that shares the prefix
 * (`/srv/web-evil` for root `/srv/web`) is outside, and undecodable escapes are malformed.
 */
export const resolveStaticPath = (webRoot: string, pathname: string): StaticPath => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return { kind: "malformed" }
  }
  const root = normalize(webRoot)
  const path = normalize(join(root, decoded))
  if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) {
    return { kind: "outside" }
  }
  return { kind: "file", path }
}
