import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Conflict, Forbidden, NotFound, RateLimited, ValidationError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { EntityId, UserId } from "../ids.ts"
import {
  AccessItemReview,
  AccessPersonReview,
  AdminOverview,
  BrandingInput,
  EmailStatus,
  EmailTestInput,
  OrphanCleanupResult,
  RetentionInput,
  SecurityInput,
  SignedUp,
  SignupInput,
  StorageSummary,
} from "./schema.ts"

const entityParams = { params: { entityId: EntityId } }
const userParams = { params: { userId: UserId } }

/** Workspace administration; owners and admins only (each command checks its capability). */
export const AdminApi = HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("overview", "/api/admin/overview", {
      success: AdminOverview,
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.get("accessItem", "/api/admin/access/items/:entityId", {
      ...entityParams,
      success: AccessItemReview,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.get("accessPerson", "/api/admin/access/people/:userId", {
      ...userParams,
      success: AccessPersonReview,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateSecurity", "/api/admin/security", {
      payload: SecurityInput,
      error: [Forbidden, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateBranding", "/api/admin/branding", {
      payload: BrandingInput,
      error: [Forbidden, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateRetention", "/api/admin/retention", {
      payload: RetentionInput,
      error: [Forbidden, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.post("runOrphanCleanup", "/api/admin/storage/orphan-cleanup", {
      success: OrphanCleanupResult,
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.get("emailStatus", "/api/admin/email", {
      success: EmailStatus,
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.post("emailTest", "/api/admin/email/test", {
      payload: EmailTestInput,
      error: [Forbidden, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.get("storage", "/api/admin/storage", {
      success: StorageSummary,
      error: [Forbidden],
    }),
  )
  .middleware(Authentication)

/** Self sign-up, public; the workspace sign-up policy decides whether it is allowed. */
export const SignupApi = HttpApiGroup.make("signup").add(
  HttpApiEndpoint.post("signup", "/api/signup", {
    payload: SignupInput,
    success: SignedUp,
    error: [Forbidden, Conflict, ValidationError, RateLimited],
  }),
)
