/** Coarse categories the UI turns into translated copy. */
export type ErrorKind =
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "validation"
  | "rateLimited"
  | "network"
  | "unknown"

const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined

export const errorKind = (error: unknown): ErrorKind => {
  switch (tagOf(error)) {
    case "Unauthorized":
      return "unauthorized"
    case "Forbidden":
      return "forbidden"
    case "NotFound":
      return "notFound"
    case "Conflict":
      return "conflict"
    case "ValidationError":
      return "validation"
    case "RateLimited":
      return "rateLimited"
    case undefined:
      return "unknown"
    default:
      return tagOf(error)?.startsWith("HttpClient") ? "network" : "unknown"
  }
}

/** Field name a `ValidationError` points at, when the server gave one. */
export const validationField = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined
  const detail = "detail" in error ? error.detail : error
  if (typeof detail !== "object" || detail === null || !("field" in detail)) return undefined
  return typeof detail.field === "string" ? detail.field : undefined
}
