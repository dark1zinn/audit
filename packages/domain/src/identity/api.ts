import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Conflict, Forbidden, NotFound, RateLimited, ValidationError } from "../errors.ts"
import { Authentication } from "../http.ts"
import { InviteId, TeamId, UserId } from "../ids.ts"
import {
  AcceptInviteInput,
  ChangeRoleInput,
  CreatedInvite,
  CreateInviteInput,
  CreateTeamInput,
  Invite,
  InvitePreview,
  Me,
  Member,
  PasswordResetLink,
  RemoveTeamMemberInput,
  SetTeamMemberInput,
  SetupInput,
  SetupStatus,
  Team,
  TeamMember,
  UpdateProfileInput,
  UpdateTeamInput,
  UpdateWorkspaceInput,
  Workspace,
} from "./schema.ts"

/** First run: no session exists yet. */
export const SetupApi = HttpApiGroup.make("setup")
  .add(HttpApiEndpoint.get("status", "/api/setup", { success: SetupStatus }))
  .add(
    HttpApiEndpoint.post("complete", "/api/setup", {
      payload: SetupInput,
      error: [Forbidden, Conflict, ValidationError],
    }),
  )

/** Invite links, opened before the person has an account. */
export const JoinApi = HttpApiGroup.make("join")
  .add(
    HttpApiEndpoint.get("preview", "/api/join/:token", {
      params: { token: Schema.String },
      success: InvitePreview,
      error: [NotFound, RateLimited],
    }),
  )
  .add(
    HttpApiEndpoint.post("accept", "/api/join", {
      payload: AcceptInviteInput,
      error: [NotFound, Conflict, ValidationError, RateLimited],
    }),
  )

export const MeApi = HttpApiGroup.make("me")
  .add(HttpApiEndpoint.get("get", "/api/me", { success: Me }))
  .add(
    HttpApiEndpoint.patch("updateProfile", "/api/me/profile", {
      payload: UpdateProfileInput,
      success: Me,
      error: [ValidationError],
    }),
  )
  .middleware(Authentication)

export const WorkspaceApi = HttpApiGroup.make("workspace")
  .add(HttpApiEndpoint.get("get", "/api/workspace", { success: Workspace, error: [Forbidden] }))
  .add(
    HttpApiEndpoint.patch("update", "/api/workspace", {
      payload: UpdateWorkspaceInput,
      success: Workspace,
      error: [Forbidden, ValidationError],
    }),
  )
  .middleware(Authentication)

const userParams = { params: { userId: UserId } }

export const MembersApi = HttpApiGroup.make("members")
  .add(HttpApiEndpoint.get("list", "/api/members", { success: Schema.Array(Member) }))
  .add(
    HttpApiEndpoint.post("changeRole", "/api/members/role", {
      payload: ChangeRoleInput,
      error: [Forbidden, NotFound, Conflict],
    }),
  )
  .add(
    HttpApiEndpoint.post("deactivate", "/api/members/:userId/deactivate", {
      ...userParams,
      error: [Forbidden, NotFound, Conflict],
    }),
  )
  .add(
    HttpApiEndpoint.post("reactivate", "/api/members/:userId/reactivate", {
      ...userParams,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.post("revokeSessions", "/api/members/:userId/revoke-sessions", {
      ...userParams,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.post("resetTwoFactor", "/api/members/:userId/reset-2fa", {
      ...userParams,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.post("passwordResetLink", "/api/members/:userId/password-reset-link", {
      ...userParams,
      success: PasswordResetLink,
      error: [Forbidden, NotFound],
    }),
  )
  .middleware(Authentication)

export const InvitesApi = HttpApiGroup.make("invites")
  .add(
    HttpApiEndpoint.get("list", "/api/invites", {
      success: Schema.Array(Invite),
      error: [Forbidden],
    }),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/invites", {
      payload: CreateInviteInput,
      success: CreatedInvite,
      error: [Forbidden, NotFound, ValidationError],
    }),
  )
  .add(
    HttpApiEndpoint.post("revoke", "/api/invites/:inviteId/revoke", {
      params: { inviteId: InviteId },
      error: [Forbidden, NotFound],
    }),
  )
  .middleware(Authentication)

export const TeamsApi = HttpApiGroup.make("teams")
  .add(HttpApiEndpoint.get("list", "/api/teams", { success: Schema.Array(Team) }))
  .add(
    HttpApiEndpoint.post("create", "/api/teams", {
      payload: CreateTeamInput,
      success: Team,
      error: [Forbidden, Conflict],
    }),
  )
  .add(
    HttpApiEndpoint.patch("update", "/api/teams", {
      payload: UpdateTeamInput,
      success: Team,
      error: [Forbidden, NotFound, Conflict],
    }),
  )
  .add(
    HttpApiEndpoint.get("members", "/api/teams/:teamId/members", {
      params: { teamId: TeamId },
      success: Schema.Array(TeamMember),
      error: [NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.post("setMember", "/api/teams/members", {
      payload: SetTeamMemberInput,
      error: [Forbidden, NotFound],
    }),
  )
  .add(
    HttpApiEndpoint.post("removeMember", "/api/teams/members/remove", {
      payload: RemoveTeamMemberInput,
      error: [Forbidden, NotFound],
    }),
  )
  .middleware(Authentication)
