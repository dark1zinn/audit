import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Conflict, Forbidden, NotFound, ValidationError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { UserId } from "../ids.ts"
import { PersonalExport } from "./schema.ts"

const userParams = { params: { userId: UserId } }

export const PeopleApi = HttpApiGroup.make("people")
  .add(
    HttpApiEndpoint.post("transferOwnership", "/api/members/:userId/transfer-ownership", {
      ...userParams,
      error: [Forbidden, NotFound, Conflict, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMember", "/api/members/:userId", {
      ...userParams,
      error: [Forbidden, NotFound, Conflict],
    }),
  )
  .add(
    HttpApiEndpoint.get("exportMine", "/api/me/export", {
      success: PersonalExport,
      error: [Forbidden],
    }),
  )
  .middleware(Authentication)
