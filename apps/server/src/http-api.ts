/**
 * HTTP handlers: decode, then call a command (writes) or a query (reads). They never touch the
 * database themselves.
 */
import { Authz } from "@audit/core/authz"
import { EventBus } from "@audit/core/event-bus"
import * as identity from "@audit/core/identity/commands"
import * as identityQueries from "@audit/core/identity/queries"
import { RequestMeta } from "@audit/core/request"
import { listTrail, verifyTrail } from "@audit/core/trail-queries"
import { CurrentActor } from "@audit/domain/actor"
import { AuditApi } from "@audit/domain/api"
import { Forbidden, Unauthorized } from "@audit/domain/errors"
import { Authentication } from "@audit/domain/http"
import { AppConfig } from "@audit/platform/config"
import { Db } from "@audit/platform/database"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { CLIENT_IP_HEADER } from "./client-ip.ts"
import { RateLimiter } from "./rate-limit.ts"
import { Sessions } from "./sessions.ts"
import { SetupToken } from "./setup-token.ts"

/** Services every command and query may need, captured once when the handlers are built. */
const coreContext = Effect.context<Db | SqlClient.SqlClient | Authz | EventBus | AppConfig>()

const systemActor = (reason: string) =>
  Effect.provideService(CurrentActor, { _tag: "system", reason } as const)

const clientMeta = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const headers = request.headers
  const ip = headers[CLIENT_IP_HEADER]
  const userAgent = headers["user-agent"]
  const requestId = headers["x-request-id"]
  return {
    ...(ip === undefined ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(requestId === undefined ? {} : { requestId }),
  }
})

export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return Authentication.of((httpEffect, { group }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const resolved = yield* sessions.resolve(
          new Headers(request.headers as Record<string, string>),
        )
        if (resolved.twoFactorRequired && group.identifier !== "me") {
          return yield* new Unauthorized({ message: "two_factor_required" })
        }
        const meta = yield* clientMeta
        return yield* httpEffect.pipe(
          Effect.provideService(CurrentActor, resolved.actor),
          Effect.provideService(RequestMeta, meta),
        )
      }),
    )
  }),
)

const SetupLive = HttpApiBuilder.group(AuditApi, "setup", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    const setupToken = yield* SetupToken
    return handlers
      .handle("status", () => identityQueries.setupStatus.pipe(Effect.provide(core)))
      .handle("complete", ({ payload }) =>
        Effect.gen(function* () {
          if (!(yield* setupToken.matches(payload.token))) {
            return yield* new Forbidden({
              action: "workspace.setup",
              message: "Invalid setup token",
            })
          }
          const meta = yield* clientMeta
          yield* identity.completeSetup
            .execute(payload)
            .pipe(
              systemActor("setup"),
              Effect.provideService(RequestMeta, meta),
              Effect.provide(core),
            )
          yield* setupToken.destroy
        }),
      )
  }),
)

const JoinLive = HttpApiBuilder.group(AuditApi, "join", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    const limiter = yield* RateLimiter
    const limit = Effect.flatMap(clientMeta, (meta) => limiter.check("join", meta.ip ?? "unknown"))
    return handlers
      .handle("preview", ({ params }) =>
        limit.pipe(
          Effect.andThen(identityQueries.previewInvite(params.token)),
          Effect.provide(core),
        ),
      )
      .handle("accept", ({ payload }) =>
        Effect.gen(function* () {
          yield* limit
          const meta = yield* clientMeta
          yield* identity.acceptInvite
            .execute(payload)
            .pipe(
              systemActor("invite"),
              Effect.provideService(RequestMeta, meta),
              Effect.provide(core),
            )
        }),
      )
  }),
)

const MeLive = HttpApiBuilder.group(AuditApi, "me", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("get", () => identityQueries.getMe.pipe(Effect.orDie, Effect.provide(core)))
      .handle("updateProfile", ({ payload }) =>
        identity.updateProfile.execute(payload).pipe(
          Effect.andThen(identityQueries.getMe),
          Effect.catchTags({
            Forbidden: (e) => Effect.die(e),
            NotFound: (e) => Effect.die(e),
            Unauthorized: (e) => Effect.die(e),
          }),
          Effect.provide(core),
        ),
      )
  }),
)

const WorkspaceLive = HttpApiBuilder.group(AuditApi, "workspace", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("get", () => identityQueries.getWorkspace.pipe(Effect.provide(core)))
      .handle("update", ({ payload }) =>
        identity.updateWorkspace.execute(payload).pipe(
          Effect.andThen(identityQueries.getWorkspace),
          Effect.catchTag("NotFound", (e) => Effect.die(e)),
          Effect.provide(core),
        ),
      )
  }),
)

const MembersLive = HttpApiBuilder.group(AuditApi, "members", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("list", () => identityQueries.listMembers.pipe(Effect.provide(core)))
      .handle("changeRole", ({ payload }) =>
        identity.changeRole.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("deactivate", ({ params }) =>
        identity.deactivateMember.execute(params.userId).pipe(Effect.provide(core)),
      )
      .handle("reactivate", ({ params }) =>
        identity.reactivateMember.execute(params.userId).pipe(Effect.provide(core)),
      )
      .handle("revokeSessions", ({ params }) =>
        identity.revokeSessions.execute(params.userId).pipe(Effect.provide(core)),
      )
      .handle("resetTwoFactor", ({ params }) =>
        identity.resetTwoFactor.execute(params.userId).pipe(Effect.provide(core)),
      )
      .handle("passwordResetLink", ({ params }) =>
        identity.createPasswordResetLink.execute(params.userId).pipe(Effect.provide(core)),
      )
  }),
)

const InvitesLive = HttpApiBuilder.group(AuditApi, "invites", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("list", () => identityQueries.listInvites.pipe(Effect.provide(core)))
      .handle("create", ({ payload }) =>
        identity.createInvite.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("revoke", ({ params }) =>
        identity.revokeInvite.execute(params.inviteId).pipe(Effect.provide(core)),
      )
  }),
)

const TeamsLive = HttpApiBuilder.group(AuditApi, "teams", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    const teamById = (teamId: string) =>
      Effect.map(identityQueries.listTeams, (teams) => teams.find((t) => t.id === teamId)!)
    return handlers
      .handle("list", () => identityQueries.listTeams.pipe(Effect.provide(core)))
      .handle("create", ({ payload }) =>
        identity.createTeam.execute(payload).pipe(Effect.flatMap(teamById), Effect.provide(core)),
      )
      .handle("update", ({ payload }) =>
        identity.updateTeam
          .execute(payload)
          .pipe(Effect.andThen(teamById(payload.teamId)), Effect.provide(core)),
      )
      .handle("members", ({ params }) =>
        identityQueries.listTeamMembers(params.teamId).pipe(Effect.provide(core)),
      )
      .handle("setMember", ({ payload }) =>
        identity.setTeamMember.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("removeMember", ({ payload }) =>
        identity.removeTeamMember.execute(payload).pipe(Effect.provide(core)),
      )
  }),
)

const TrailLive = HttpApiBuilder.group(AuditApi, "trail", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("list", ({ query }) => listTrail(query).pipe(Effect.provide(core)))
      .handle("verify", () => verifyTrail.pipe(Effect.provide(core)))
  }),
)

export const HttpApiLive = HttpApiBuilder.layer(AuditApi, {
  openapiPath: "/api/openapi.json",
}).pipe(
  Layer.provide([
    SetupLive,
    JoinLive,
    MeLive,
    WorkspaceLive,
    MembersLive,
    InvitesLive,
    TeamsLive,
    TrailLive,
  ]),
  Layer.provide(AuthenticationLive),
)
