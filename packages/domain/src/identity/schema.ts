import { Schema } from "effect"
import { InviteId, ProjectId, TeamId, UserId } from "../ids.ts"
import { ResourceRole, TeamRole, WorkspaceRole } from "../roles.ts"

export const Locale = Schema.Literals(["en", "pt-BR", "es"])
export type Locale = typeof Locale.Type

export const Email = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  Schema.isMaxLength(320),
)

export const Password = Schema.String.check(Schema.isMinLength(10), Schema.isMaxLength(256))

export const PersonName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
)

export const WorkspaceName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
)

// --- Setup ---------------------------------------------------------------

export const SetupStatus = Schema.Struct({
  needsSetup: Schema.Boolean,
  emailEnabled: Schema.Boolean,
})
export type SetupStatus = typeof SetupStatus.Type

export const SetupInput = Schema.Struct({
  token: Schema.String,
  workspaceName: WorkspaceName,
  name: PersonName,
  email: Email,
  password: Password,
  locale: Schema.optionalKey(Locale),
  timezone: Schema.optionalKey(Schema.String),
})
export type SetupInput = typeof SetupInput.Type

// --- Workspace -----------------------------------------------------------

export const TwoFactorPolicy = Schema.Literals(["off", "admins", "everyone"])
export type TwoFactorPolicy = typeof TwoFactorPolicy.Type

export const SignupPolicy = Schema.Struct({
  mode: Schema.Literals(["closed", "domains"]),
  domains: Schema.Array(Schema.String),
})
export type SignupPolicy = typeof SignupPolicy.Type

export const WorkspaceSettings = Schema.Struct({
  membersCanInvite: Schema.Boolean,
  twoFactorPolicy: TwoFactorPolicy,
  defaultLocale: Locale,
  sessionDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 })),
  idleDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })),
  accentColor: Schema.String,
  defaultTheme: Schema.Literals(["light", "dark", "system"]),
  trailRetentionDays: Schema.Int.check(Schema.isBetween({ minimum: 30, maximum: 3650 })),
  /** Chat messages older than this are purged daily; null keeps them forever. */
  messageRetentionDays: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3650 })),
  ),
  uploadLimitMb: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1024 })),
  storageQuotaGb: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
})
export type WorkspaceSettings = typeof WorkspaceSettings.Type

export const defaultWorkspaceSettings: WorkspaceSettings = {
  membersCanInvite: false,
  twoFactorPolicy: "off",
  defaultLocale: "en",
  sessionDays: 30,
  idleDays: 7,
  accentColor: "#4f46e5",
  defaultTheme: "system",
  trailRetentionDays: 365,
  messageRetentionDays: null,
  uploadLimitMb: 50,
  storageQuotaGb: 10,
}

/** Whether the workspace 2FA policy applies to someone with this role. */
export const policyRequiresTwoFactor = (policy: TwoFactorPolicy, role: WorkspaceRole): boolean =>
  policy === "everyone" || (policy === "admins" && (role === "owner" || role === "admin"))

export const Workspace = Schema.Struct({
  name: Schema.String,
  settings: WorkspaceSettings,
  signupPolicy: SignupPolicy,
  searchConfig: Schema.Literals(["english", "portuguese", "spanish"]),
})
export type Workspace = typeof Workspace.Type

export const UpdateWorkspaceInput = Schema.Struct({
  name: Schema.optionalKey(WorkspaceName),
  settings: Schema.optionalKey(WorkspaceSettings),
  signupPolicy: Schema.optionalKey(SignupPolicy),
  searchConfig: Schema.optionalKey(Schema.Literals(["english", "portuguese", "spanish"])),
})
export type UpdateWorkspaceInput = typeof UpdateWorkspaceInput.Type

// --- People --------------------------------------------------------------

export const Me = Schema.Struct({
  userId: UserId,
  email: Schema.String,
  displayName: Schema.String,
  title: Schema.NullOr(Schema.String),
  role: WorkspaceRole,
  timezone: Schema.String,
  locale: Schema.NullOr(Locale),
  twoFactorEnabled: Schema.Boolean,
  /** The workspace policy requires 2FA and this person has not enrolled: only security settings work. */
  twoFactorRequired: Schema.Boolean,
  workspace: Schema.Struct({
    name: Schema.String,
    defaultLocale: Locale,
    defaultTheme: Schema.Literals(["light", "dark", "system"]),
    accentColor: Schema.String,
    membersCanInvite: Schema.Boolean,
  }),
})
export type Me = typeof Me.Type

export const UpdateProfileInput = Schema.Struct({
  displayName: Schema.optionalKey(PersonName),
  title: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(120)))),
  timezone: Schema.optionalKey(Schema.String),
  locale: Schema.optionalKey(Schema.NullOr(Locale)),
})
export type UpdateProfileInput = typeof UpdateProfileInput.Type

export const Member = Schema.Struct({
  userId: UserId,
  email: Schema.String,
  displayName: Schema.String,
  title: Schema.NullOr(Schema.String),
  role: WorkspaceRole,
  twoFactorEnabled: Schema.Boolean,
  joinedAt: Schema.Date,
  lastSeenAt: Schema.NullOr(Schema.Date),
  deactivatedAt: Schema.NullOr(Schema.Date),
})
export type Member = typeof Member.Type

export const ChangeRoleInput = Schema.Struct({
  userId: UserId,
  role: Schema.Literals(["admin", "member", "guest"]),
})
export type ChangeRoleInput = typeof ChangeRoleInput.Type

export const PasswordResetLink = Schema.Struct({ url: Schema.String, expiresAt: Schema.Date })
export type PasswordResetLink = typeof PasswordResetLink.Type

// --- Invites -------------------------------------------------------------

export const ProjectGrant = Schema.Struct({ projectId: ProjectId, role: ResourceRole })
export type ProjectGrant = typeof ProjectGrant.Type

export const InviteStatus = Schema.Literals(["active", "expired", "revoked", "used"])
export type InviteStatus = typeof InviteStatus.Type

export const Invite = Schema.Struct({
  id: InviteId,
  email: Schema.NullOr(Schema.String),
  role: Schema.Literals(["member", "guest"]),
  teamIds: Schema.Array(TeamId),
  projectGrants: Schema.Array(ProjectGrant),
  expiresAt: Schema.Date,
  maxUses: Schema.Int,
  useCount: Schema.Int,
  revokedAt: Schema.NullOr(Schema.Date),
  createdBy: UserId,
  note: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
  status: InviteStatus,
})
export type Invite = typeof Invite.Type

export const CreateInviteInput = Schema.Struct({
  email: Schema.optionalKey(Email),
  role: Schema.Literals(["member", "guest"]),
  teamIds: Schema.optionalKey(Schema.Array(TeamId)),
  projectGrants: Schema.optionalKey(Schema.Array(ProjectGrant)),
  /** 1 hour to 90 days; defaults to 7 days. */
  expiresInHours: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 * 24 })),
  ),
  maxUses: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
})
export type CreateInviteInput = typeof CreateInviteInput.Type

/** Returned once on creation: the only time the token is visible. */
export const CreatedInvite = Schema.Struct({ invite: Invite, url: Schema.String })
export type CreatedInvite = typeof CreatedInvite.Type

export const InvitePreview = Schema.Struct({
  workspaceName: Schema.String,
  email: Schema.NullOr(Schema.String),
  role: Schema.Literals(["member", "guest"]),
  expiresAt: Schema.Date,
})
export type InvitePreview = typeof InvitePreview.Type

export const AcceptInviteInput = Schema.Struct({
  token: Schema.String,
  name: PersonName,
  email: Email,
  password: Password,
  locale: Schema.optionalKey(Locale),
  timezone: Schema.optionalKey(Schema.String),
})
export type AcceptInviteInput = typeof AcceptInviteInput.Type

// --- Teams ---------------------------------------------------------------

export const Team = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  slug: Schema.String,
  kind: Schema.Literals(["workspace", "project"]),
  projectId: Schema.NullOr(ProjectId),
  memberCount: Schema.Int,
})
export type Team = typeof Team.Type

export const TeamMember = Schema.Struct({
  userId: UserId,
  displayName: Schema.String,
  role: TeamRole,
})
export type TeamMember = typeof TeamMember.Type

export const Slug = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(60),
)

export const CreateTeamInput = Schema.Struct({ name: WorkspaceName, slug: Slug })
export type CreateTeamInput = typeof CreateTeamInput.Type

export const UpdateTeamInput = Schema.Struct({
  teamId: TeamId,
  name: Schema.optionalKey(WorkspaceName),
  slug: Schema.optionalKey(Slug),
})
export type UpdateTeamInput = typeof UpdateTeamInput.Type

export const SetTeamMemberInput = Schema.Struct({ teamId: TeamId, userId: UserId, role: TeamRole })
export type SetTeamMemberInput = typeof SetTeamMemberInput.Type

export const RemoveTeamMemberInput = Schema.Struct({ teamId: TeamId, userId: UserId })
export type RemoveTeamMemberInput = typeof RemoveTeamMemberInput.Type
