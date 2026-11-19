import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Forbidden } from "../errors.ts"
import { Authentication } from "../http.ts"
import { TrailFilter, TrailPage, TrailVerification } from "./schema.ts"

export const TrailApi = HttpApiGroup.make("trail")
  .add(
    HttpApiEndpoint.get("list", "/api/trail", {
      query: TrailFilter,
      success: TrailPage,
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.post("verify", "/api/trail/verify", {
      success: TrailVerification,
      error: [Forbidden],
    }),
  )
  .middleware(Authentication)
