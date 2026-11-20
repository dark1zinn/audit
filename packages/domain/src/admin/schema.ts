import { Schema } from "effect"
import { Email, Password, SignupPolicy, WorkspaceName } from "../identity/schema.ts"
import { EntityId, FileId, Uuid, UserId } from "../ids.ts"
import { ResourceRole, WorkspaceRole } from "../roles.ts"

const Days = (minimum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum: 3650 }))

/** Sign-up rules and the breached-password check. */
export const SecurityInput = Schema.Struct({
  signupPolicy: SignupPolicy,
  breachedPasswordCheck: Schema.Boolean,
})
export type SecurityInput = typeof SecurityInput.Type

export const BrandingInput = Schema.Struct({
  name: WorkspaceName,
  logoFileId: Schema.optionalKey(FileId),
  accentColor: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  defaultTheme: Schema.Literals(["light", "dark", "system"]),
})
export type BrandingInput = typeof BrandingInput.Type

/** Retention windows, in days. Trail entries are kept at least 30 days. */
export const RetentionInput = Schema.Struct({
  trailRetentionDays: Days(30),
  softDeleteRetentionDays: Days(1),
})
export type RetentionInput = typeof RetentionInput.Type

/** Self sign-up, allowed by the workspace's sign-up policy. */
export const SignupInput = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  email: Email,
  password: Password,
  locale: Schema.optionalKey(Schema.Literals(["en", "pt-BR", "es"])),
  timezone: Schema.optionalKey(Schema.String),
})
export type SignupInput = typeof SignupInput.Type

/**
 * `email`: the verification link was mailed. `approval`: an admin decides. The answer depends only
 * on the server's mail setup, never on whether the address already has an account.
 */
export const SignedUp = Schema.Struct({ delivery: Schema.Literals(["email", "approval"]) })
export type SignedUp = typeof SignedUp.Type

export const VerifySignupInput = Schema.Struct({
  token: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
})
export type VerifySignupInput = typeof VerifySignupInput.Type

/** A sign-up waiting for an admin's approval (no mail configured). */
export const PendingSignup = Schema.Struct({
  id: Uuid,
  name: Schema.String,
  email: Schema.String,
  requestedAt: Schema.Date,
})
export type PendingSignup = typeof PendingSignup.Type

export const EmailTestInput = Schema.Struct({ to: Email })
export type EmailTestInput = typeof EmailTestInput.Type

export const EmailStatus = Schema.Struct({ enabled: Schema.Boolean })

export const StorageSummary = Schema.Struct({
  usedBytes: Schema.Number,
  quotaBytes: Schema.Number,
  uploadLimitBytes: Schema.Number,
  /** Files no entity references any more, waiting for the orphan cleanup. */
  orphanedFiles: Schema.Number,
  /** Soft-deleted files waiting for the retention job. */
  softDeletedFiles: Schema.Number,
})

export const AdminOverview = Schema.Struct({
  members: Schema.Number,
  owners: Schema.Number,
  admins: Schema.Number,
  pendingInvites: Schema.Number,
  trailEvents: Schema.Number,
  emailEnabled: Schema.Boolean,
  signupPolicy: SignupPolicy,
  breachedPasswordCheck: Schema.Boolean,
  storage: StorageSummary,
  version: Schema.String,
  gitSha: Schema.NullOr(Schema.String),
})

export const AccessGrant = Schema.Struct({
  entityId: EntityId,
  entityTitle: Schema.String,
  entityType: Schema.String,
  principalType: Schema.Literals(["user", "team", "role"]),
  principalId: Schema.NullOr(Schema.String),
  principalRole: Schema.NullOr(WorkspaceRole),
  role: ResourceRole,
  source: Schema.Literals(["direct", "team", "role", "inherited"]),
})
export type AccessGrant = typeof AccessGrant.Type

/** Who can reach one entity: explicit grants, then each active member's effective role. */
export const AccessItemReview = Schema.Struct({
  entityId: EntityId,
  entityTitle: Schema.String,
  entityType: Schema.String,
  restricted: Schema.Boolean,
  grants: Schema.Array(AccessGrant),
  effective: Schema.Array(Schema.Struct({ userId: UserId, role: ResourceRole })),
})

/**
 * A grant that reaches one person, with the explanation: the team it came through (if any), whether
 * it covers the granted item alone or flows down to its children, and how many restricted direct
 * children it does not reach (restricted items inherit nothing and need their own grant).
 */
export const PersonGrant = Schema.Struct({
  ...AccessGrant.fields,
  teamName: Schema.NullOr(Schema.String),
  restricted: Schema.Boolean,
  scope: Schema.Literals(["own", "container"]),
  restrictedChildren: Schema.Number,
})
export type PersonGrant = typeof PersonGrant.Type

/** Everything one person can reach through direct, team and role grants, and why. */
export const AccessPersonReview = Schema.Struct({
  userId: UserId,
  workspaceRole: Schema.NullOr(WorkspaceRole),
  grants: Schema.Array(PersonGrant),
})

export const OrphanCleanupResult = Schema.Struct({ purged: Schema.Number })

/** A background maintenance job's latest request and completion, read from the trail. */
export const MaintenanceJobStatus = Schema.Struct({
  state: Schema.Literals(["idle", "queued", "done"]),
  requestedAt: Schema.NullOr(Schema.Date),
  completedAt: Schema.NullOr(Schema.Date),
  /** Docs compacted or boards rebalanced by the latest completed run. */
  count: Schema.NullOr(Schema.Number),
})
export type MaintenanceJobStatus = typeof MaintenanceJobStatus.Type

export const MaintenanceStatus = Schema.Struct({
  rebalance: MaintenanceJobStatus,
  compaction: MaintenanceJobStatus,
  reembed: MaintenanceJobStatus,
})
export type MaintenanceStatus = typeof MaintenanceStatus.Type

export const MaintenanceQueued = Schema.Struct({ queued: Schema.Literal(true) })
