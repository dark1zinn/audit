import { AuditApi } from "@audit/domain/api"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

/** Client for the `/api` HTTP surface, typed from the shared `AuditApi` definition. */
const makeClient = () => HttpApiClient.make(AuditApi, { baseUrl: window.location.origin })

export type ApiClient = Effect.Success<ReturnType<typeof makeClient>>

/** Promise-shaped failure. `_tag` is the typed domain error tag, or the transport error tag. */
export class ApiError extends Error {
  readonly _tag: string
  readonly detail: unknown

  constructor(tag: string, detail: unknown) {
    super(tag)
    this._tag = tag
    this.detail = detail
    this.name = "ApiError"
  }
}

const tagOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : "UnknownError"

/**
 * Runs one API call and resolves with its value. Typed errors reject with `ApiError`, keeping
 * their `_tag` so callers (TanStack Query, forms) can branch on them.
 */
export const callApi = <A>(call: (client: ApiClient) => Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(
    makeClient().pipe(
      Effect.flatMap(call),
      Effect.provide(FetchHttpClient.layer),
      Effect.scoped,
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error }),
      }),
    ),
  ).then((result) => {
    if (result.ok) return result.value
    throw new ApiError(tagOf(result.error), result.error)
  })
