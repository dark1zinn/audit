import {
  accessEntries,
  invites,
  projects,
  pushSubscriptions,
  session,
  teamMembers,
  teams,
  twoFactor,
  notificationPrefs,
  user,
  userProfiles,
  verification,
  workspace,
  workspaceMembers,
  entities,
} from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Conflict, Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { type InviteId, TeamId, type UserId, UserId as UserIdSchema } from "@audit/domain/ids"
import {
  AcceptInviteInput,
  ChangeRoleInput,
  CreatedInvite,
  CreateInviteInput,
  CreateTeamInput,
  defaultWorkspaceSettings,
  PasswordResetLink,
  RemoveTeamMemberInput,
  SetTeamMemberInput,
  SetupInput,
  UpdateProfileInput,
  UpdateTeamInput,
  UpdateWorkspaceInput,
  type WorkspaceSettings,
} from "@audit/domain/identity/schema"
import { InviteId as InviteIdSchema } from "@audit/domain/ids"
import type { WorkspaceCapability } from "@audit/domain/permissions"
import { AppConfig } from "@audit/platform/config"
import { generateToken, sha256Hex } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { Jobs } from "@audit/platform/jobs"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import { notify } from "../notifications/notify.ts"
import { inviteMailJob } from "../notifications/account-mail.ts"
import { Mailer } from "../notifications/mail.ts"
import * as Command from "../command.ts"
import { diff, emit, record } from "../trail.ts"
import { createAccount, normalizeEmail } from "./accounts.ts"
import { inviteStatus, toInvite } from "./queries.ts"
import { resetIdentifier } from "./reset-token.ts"

const requireCapability = (capability: WorkspaceCapability) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability(capability)
  })

const currentUserId = Effect.gen(function* () {
  const userId = actorUserId(yield* CurrentActor)
  if (userId === null) {
    return yield* new Forbidden({ action: "user", message: "Only people can do this" })
  }
  return userId
})

const memberEvent = (userId: UserId, actorId: UserId | null) =>
  emit({
    _tag: "MembersChanged",
    userId,
    entityId: userId,
    projectId: null,
    actorId,
    version: null,
  })

const loadMember = (userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [member] = yield* db
      .select({
        role: workspaceMembers.role,
        deactivatedAt: userProfiles.deactivatedAt,
        email: user.email,
      })
      .from(workspaceMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, workspaceMembers.userId))
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.userId, userId))
      .for("update")
    if (member === undefined) return yield* new NotFound({ entity: "member", id: userId })
    return member
  })

/** Owners are only changed by ownership transfer; nobody manages themselves here. */
const guardManageable = (target: { readonly role: string }, targetId: UserId, action: string) =>
  Effect.gen(function* () {
    const actorId = actorUserId(yield* CurrentActor)
    if (actorId === targetId) {
      return yield* new Forbidden({ action, message: "You cannot do this to your own account" })
    }
    if (target.role === "owner") {
      return yield* new Forbidden({ action, message: "The owner cannot be changed this way" })
    }
  })

// --- Setup and invites ------------------------------------------------------

/** First run: creates the workspace and its owner. The server checks the setup token first. */
export const completeSetup = Command.make("workspace.setup", {
  input: SetupInput,
  output: UserIdSchema,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      yield* db.execute(sql`select pg_advisory_xact_lock(hashtext('audit:setup'))`)
      const [existing] = yield* db.select({ id: workspace.id }).from(workspace)
      if (existing !== undefined) {
        return yield* new Conflict({ message: "The workspace is already set up" })
      }
      yield* db.insert(workspace).values({
        name: input.workspaceName,
        settings: { ...defaultWorkspaceSettings, defaultLocale: input.locale ?? "en" },
      })
      yield* record({ action: "workspace.created", details: { name: input.workspaceName } })
      return yield* createAccount({
        name: input.name,
        email: input.email,
        password: input.password,
        role: "owner",
        invitedBy: null,
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      })
    }),
})

const DAY_HOURS = 24

export const createInvite = Command.make("invite.create", {
  input: CreateInviteInput,
  output: CreatedInvite,
  authorize: (input) =>
    Effect.gen(function* () {
      yield* requireCapability("invites.create")
      const hasGrants = (input.teamIds?.length ?? 0) > 0 || (input.projectGrants?.length ?? 0) > 0
      if (hasGrants) yield* requireCapability("invites.manage")
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const config = yield* AppConfig
      const createdBy = yield* currentUserId
      const teamIds = input.teamIds ?? []
      const projectGrants = input.projectGrants ?? []
      if (teamIds.length > 0) {
        const found = yield* db
          .select({ id: teams.id })
          .from(teams)
          .where(inArray(teams.id, teamIds))
        if (found.length !== new Set(teamIds).size) {
          return yield* new NotFound({ entity: "team", id: teamIds.join(",") })
        }
      }
      if (projectGrants.length > 0) {
        const ids = projectGrants.map((g) => g.projectId)
        const found = yield* db
          .select({ id: projects.id })
          .from(projects)
          .where(inArray(projects.id, ids))
        if (found.length !== new Set(ids).size) {
          return yield* new NotFound({ entity: "project", id: ids.join(",") })
        }
      }
      const token = generateToken()
      const expiresAt = new Date(Date.now() + (input.expiresInHours ?? 7 * DAY_HOURS) * 3_600_000)
      const [row] = yield* db
        .insert(invites)
        .values({
          tokenHash: sha256Hex(token),
          email: input.email === undefined ? null : normalizeEmail(input.email),
          role: input.role,
          teamIds: [...teamIds],
          projectGrants: [...projectGrants],
          expiresAt,
          maxUses: input.maxUses ?? 1,
          createdBy,
          note: input.note ?? null,
        })
        .returning()
      const invite = toInvite(row!, new Date())
      yield* record({
        action: "invite.created",
        details: {
          inviteId: invite.id,
          email: invite.email,
          role: invite.role,
          teamIds,
          projectGrants,
          expiresAt: expiresAt.toISOString(),
          maxUses: invite.maxUses,
        },
      })
      yield* emit({
        _tag: "InvitesChanged",
        entityId: null,
        projectId: null,
        actorId: createdBy,
        version: null,
      })
      const url = new URL(`/join/${token}`, config.url).toString()
      if (invite.email !== null && (yield* Mailer).enabled) {
        const jobs = yield* Jobs
        yield* jobs.enqueue(inviteMailJob, { email: invite.email, url })
      }
      return { invite, url }
    }),
})

export const revokeInvite = Command.make("invite.revoke", {
  input: InviteIdSchema,
  output: Schema.Void,
  authorize: () => requireCapability("invites.create"),
  run: (inviteId: InviteId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const actorId = yield* currentUserId
      const authz = yield* Authz
      const [row] = yield* db.select().from(invites).where(eq(invites.id, inviteId)).for("update")
      if (row === undefined) return yield* new NotFound({ entity: "invite", id: inviteId })
      if (row.createdBy !== actorId) yield* authz.requireCapability("invites.manage")
      if (row.revokedAt !== null) return
      yield* db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, inviteId))
      yield* record({ action: "invite.revoked", details: { inviteId } })
      yield* emit({
        _tag: "InvitesChanged",
        entityId: null,
        projectId: null,
        actorId,
        version: null,
      })
    }),
})

/** Runs as the system actor: the person accepting has no account yet. */
export const acceptInvite = Command.make("invite.accept", {
  input: AcceptInviteInput,
  output: UserIdSchema,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const [row] = yield* db
        .select()
        .from(invites)
        .where(eq(invites.tokenHash, sha256Hex(input.token)))
        .for("update")
      if (row === undefined || inviteStatus(row, new Date()) !== "active") {
        return yield* new NotFound({ entity: "invite", id: "token" })
      }
      if (row.email !== null && row.email !== normalizeEmail(input.email)) {
        return yield* new ValidationError({
          message: "This invite is for a different email address",
          field: "email",
        })
      }
      const userId = yield* createAccount({
        name: input.name,
        email: input.email,
        password: input.password,
        role: row.role,
        invitedBy: row.createdBy as UserId | null,
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      })
      if (row.teamIds.length > 0) {
        yield* db
          .insert(teamMembers)
          .values(row.teamIds.map((teamId) => ({ teamId, userId, role: "member" as const })))
          .onConflictDoNothing()
      }
      for (const grant of row.projectGrants) {
        yield* db
          .insert(accessEntries)
          .values({
            resourceId: grant.projectId,
            principalType: "user",
            principalId: userId,
            role: grant.role,
            grantedBy: row.createdBy,
          })
          .onConflictDoNothing()
      }
      yield* db
        .update(invites)
        .set({ useCount: sql`${invites.useCount} + 1` })
        .where(eq(invites.id, row.id))
      yield* authz.rebuild({ userId })
      yield* record({
        action: "invite.accepted",
        entityId: userId,
        entityType: "user",
        details: { inviteId: row.id, teamIds: row.teamIds, projectGrants: row.projectGrants },
      })
      yield* emit({
        _tag: "InvitesChanged",
        entityId: null,
        projectId: null,
        actorId: userId,
        version: null,
      })
      const admins = yield* db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .innerJoin(
          notificationPrefs,
          and(
            eq(notificationPrefs.userId, workspaceMembers.userId),
            eq(notificationPrefs.kind, "invite_accepted"),
            eq(notificationPrefs.channel, "in_app"),
            eq(notificationPrefs.enabled, true),
          ),
        )
        .where(inArray(workspaceMembers.role, ["owner", "admin"]))
        .pipe(Effect.orDie)
      for (const admin of admins) {
        yield* notify({
          userId: admin.userId as UserId,
          kind: "invite_accepted",
          entityId: userId,
          projectId: null,
          actorId: userId,
          payload: { title: input.name },
          groupKey: `invite_accepted:${userId}`,
        })
      }
      return userId
    }),
})

// --- Members ----------------------------------------------------------------

export const changeRole = Command.make("member.role_changed", {
  input: ChangeRoleInput,
  output: Schema.Void,
  authorize: () => requireCapability("members.manage"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const member = yield* loadMember(input.userId)
      yield* guardManageable(member, input.userId, "member.role_changed")
      const actor = yield* CurrentActor
      if (member.role === input.role) return
      yield* db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(eq(workspaceMembers.userId, input.userId))
      yield* authz.rebuild({ userId: input.userId })
      yield* record({
        action: "member.role_changed",
        entityId: input.userId,
        entityType: "user",
        diff: { role: [member.role, input.role] },
      })
      yield* memberEvent(input.userId, actorUserId(actor))
    }),
})

const revokeAllSessions = (userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.delete(session).where(eq(session.userId, userId))
  })

export const deactivateMember = Command.make("member.deactivated", {
  input: UserIdSchema,
  output: Schema.Void,
  authorize: () => requireCapability("members.manage"),
  run: (userId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const member = yield* loadMember(userId)
      yield* guardManageable(member, userId, "member.deactivated")
      if (member.deactivatedAt !== null) return
      yield* db
        .update(userProfiles)
        .set({ deactivatedAt: new Date(), icalTokenHash: null })
        .where(eq(userProfiles.userId, userId))
      yield* db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
      yield* revokeAllSessions(userId)
      yield* record({ action: "member.deactivated", entityId: userId, entityType: "user" })
      yield* memberEvent(userId, actorUserId(yield* CurrentActor))
    }),
})

export const reactivateMember = Command.make("member.reactivated", {
  input: UserIdSchema,
  output: Schema.Void,
  authorize: () => requireCapability("members.manage"),
  run: (userId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const member = yield* loadMember(userId)
      if (member.deactivatedAt === null) return
      yield* db
        .update(userProfiles)
        .set({ deactivatedAt: null })
        .where(eq(userProfiles.userId, userId))
      yield* record({ action: "member.reactivated", entityId: userId, entityType: "user" })
      yield* memberEvent(userId, actorUserId(yield* CurrentActor))
    }),
})

export const revokeSessions = Command.make("member.sessions_revoked", {
  input: UserIdSchema,
  output: Schema.Void,
  authorize: () => requireCapability("members.manage"),
  run: (userId) =>
    Effect.gen(function* () {
      const member = yield* loadMember(userId)
      if (member.role === "owner" && actorUserId(yield* CurrentActor) !== userId) {
        yield* requireCapability("workspace.transfer")
      }
      yield* revokeAllSessions(userId)
      yield* memberEvent(userId, actorUserId(yield* CurrentActor))
      yield* record({ action: "member.sessions_revoked", entityId: userId, entityType: "user" })
    }),
})

export const resetTwoFactor = Command.make("member.two_factor_reset", {
  input: UserIdSchema,
  output: Schema.Void,
  authorize: () => requireCapability("members.manage"),
  run: (userId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const member = yield* loadMember(userId)
      yield* guardManageable(member, userId, "member.two_factor_reset")
      yield* db.delete(twoFactor).where(eq(twoFactor.userId, userId))
      yield* db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId))
      yield* revokeAllSessions(userId)
      yield* record({ action: "member.two_factor_reset", entityId: userId, entityType: "user" })
      yield* memberEvent(userId, actorUserId(yield* CurrentActor))
    }),
})

const RESET_LINK_HOURS = 24

/** One-time reset link for workspaces without email; uses Better Auth's reset-password token. */
export const createPasswordResetLink = Command.make("member.password_reset_link_created", {
  input: UserIdSchema,
  output: PasswordResetLink,
  authorize: () => requireCapability("members.manage"),
  run: (userId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const config = yield* AppConfig
      const member = yield* loadMember(userId)
      yield* guardManageable(member, userId, "member.password_reset_link_created")
      const token = generateToken(24)
      const expiresAt = new Date(Date.now() + RESET_LINK_HOURS * 3_600_000)
      yield* db
        .insert(verification)
        .values({ identifier: resetIdentifier(token), value: userId, expiresAt })
      yield* record({
        action: "member.password_reset_link_created",
        entityId: userId,
        entityType: "user",
      })
      return {
        url: new URL(`/reset-password?token=${token}`, config.url).toString(),
        expiresAt,
      }
    }),
})

// --- Profile and workspace ---------------------------------------------------

export const updateProfile = Command.make("profile.updated", {
  input: UpdateProfileInput,
  output: Schema.Void,
  authorize: () => Effect.void,
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const userId = yield* currentUserId
      if (
        input.timezone !== undefined &&
        !Intl.supportedValuesOf("timeZone").includes(input.timezone)
      ) {
        return yield* new ValidationError({ message: "Unknown time zone", field: "timezone" })
      }
      const [before] = yield* db.select().from(userProfiles).where(eq(userProfiles.userId, userId))
      if (before === undefined) return yield* new NotFound({ entity: "member", id: userId })
      const changes = diff(before, input, ["displayName", "title", "timezone", "locale"])
      if (Object.keys(changes).length === 0) return
      yield* db.update(userProfiles).set(input).where(eq(userProfiles.userId, userId))
      if (input.displayName !== undefined) {
        yield* db.update(user).set({ name: input.displayName }).where(eq(user.id, userId))
        yield* db
          .update(entities)
          .set({ title: input.displayName, updatedAt: new Date() })
          .where(eq(entities.id, userId))
      }
      yield* record({
        action: "profile.updated",
        entityId: userId,
        entityType: "user",
        diff: changes,
      })
      yield* emit({
        _tag: "ProfileUpdated",
        userId,
        entityId: userId,
        projectId: null,
        actorId: userId,
        version: null,
      })
    }),
})

export const updateWorkspace = Command.make("workspace.updated", {
  input: UpdateWorkspaceInput,
  output: Schema.Void,
  authorize: () => requireCapability("workspace.settings"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [before] = yield* db.select().from(workspace).for("update")
      if (before === undefined) return yield* new NotFound({ entity: "workspace", id: "1" })
      const changes = diff(
        {
          name: before.name,
          settings: before.settings as WorkspaceSettings,
          signupPolicy: before.signupPolicy,
          searchConfig: before.searchConfig,
        },
        input,
        ["name", "settings", "signupPolicy", "searchConfig"],
      )
      if (Object.keys(changes).length === 0) return
      // The stored VAPID entry is internal: a settings save must not drop it.
      const vapid =
        typeof before.settings === "object" &&
        before.settings !== null &&
        "vapid" in before.settings
          ? before.settings.vapid
          : undefined
      yield* db
        .update(workspace)
        .set({
          ...input,
          ...(input.settings === undefined ? {} : { settings: { ...input.settings, vapid } }),
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, 1))
      if (input.searchConfig !== undefined && input.searchConfig !== before.searchConfig) {
        // Recompute every search vector with the new text-search configuration.
        yield* db.execute(sql`update entities set search_text = search_text`)
      }
      yield* record({ action: "workspace.updated", diff: changes })
      yield* emit({
        _tag: "WorkspaceUpdated",
        entityId: null,
        projectId: null,
        actorId: actorUserId(yield* CurrentActor),
        version: null,
      })
    }),
})

// --- Teams ------------------------------------------------------------------

const teamsEvent = Effect.gen(function* () {
  yield* emit({
    _tag: "TeamsChanged",
    entityId: null,
    projectId: null,
    actorId: actorUserId(yield* CurrentActor),
    version: null,
  })
})

const slugClash = () =>
  Effect.fail(new Conflict({ message: "Another team already uses this slug" }))

export const createTeam = Command.make("team.created", {
  input: CreateTeamInput,
  output: TeamId,
  authorize: () => requireCapability("teams.manage"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const createdBy = yield* currentUserId
      const teamId = Bun.randomUUIDv7() as TeamId
      yield* db.insert(entities).values({ id: teamId, type: "team", title: input.name, createdBy })
      yield* db
        .insert(teams)
        .values({ id: teamId, name: input.name, slug: input.slug, kind: "workspace" })
        .pipe(Effect.catchIf(Command.isUniqueViolation, slugClash))
      yield* record({
        action: "team.created",
        entityId: teamId,
        entityType: "team",
        details: input,
      })
      yield* teamsEvent
      return teamId
    }),
})

export const updateTeam = Command.make("team.updated", {
  input: UpdateTeamInput,
  output: Schema.Void,
  authorize: () => requireCapability("teams.manage"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [before] = yield* db
        .select()
        .from(teams)
        .where(eq(teams.id, input.teamId))
        .for("update")
      if (before === undefined) return yield* new NotFound({ entity: "team", id: input.teamId })
      const { teamId, ...changes } = input
      const changed = diff(before, changes, ["name", "slug"])
      if (Object.keys(changed).length === 0) return
      yield* db
        .update(teams)
        .set(changes)
        .where(eq(teams.id, teamId))
        .pipe(Effect.catchIf(Command.isUniqueViolation, slugClash))
      if (changes.name !== undefined) {
        yield* db
          .update(entities)
          .set({ title: changes.name, updatedAt: new Date() })
          .where(eq(entities.id, teamId))
      }
      yield* record({ action: "team.updated", entityId: teamId, entityType: "team", diff: changed })
      yield* teamsEvent
    }),
})

/** Owners and admins hold `teams.manage`; team leads do not. */
const canManageTeams = Effect.gen(function* () {
  const authz = yield* Authz
  return yield* authz.requireCapability("teams.manage").pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
})

/** Admins manage every team; a team lead manages their own team's members. */
const authorizeTeamMembership = (teamId: TeamId) =>
  Effect.gen(function* () {
    if (yield* canManageTeams) return
    const userId = yield* currentUserId
    const db = yield* Db
    const [lead] = yield* db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .pipe(Effect.orDie)
    if (lead?.role !== "lead") {
      return yield* new Forbidden({
        action: "team.members",
        message: "Only team leads and admins can change members",
      })
    }
  })

export const setTeamMember = Command.make("team.member_set", {
  input: SetTeamMemberInput,
  output: Schema.Void,
  authorize: (input) => authorizeTeamMembership(input.teamId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const manager = yield* canManageTeams
      const [team] = yield* db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.id, input.teamId))
      if (team === undefined) return yield* new NotFound({ entity: "team", id: input.teamId })
      const [member] = yield* db
        .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, input.userId))
      if (member === undefined) return yield* new NotFound({ entity: "member", id: input.userId })
      const [before] = yield* db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)))
      if (before?.role === input.role) return
      const [grant] = yield* db
        .select({ id: accessEntries.id })
        .from(accessEntries)
        .where(
          and(eq(accessEntries.principalType, "team"), eq(accessEntries.principalId, input.teamId)),
        )
        .limit(1)
        .pipe(Effect.orDie)
      const addsGuest = before === undefined && member.role === "guest"
      const promotes = input.role === "lead" && before?.role !== "lead"
      if (!manager && grant !== undefined && (addsGuest || promotes)) {
        return yield* new Forbidden({
          action: "team.members",
          message: "Only admins can add guests or leads to a team that holds grants",
        })
      }
      yield* db
        .insert(teamMembers)
        .values(input)
        .onConflictDoUpdate({
          target: [teamMembers.teamId, teamMembers.userId],
          set: { role: input.role },
        })
      yield* authz.rebuild({ userId: input.userId })
      yield* record({
        action: before === undefined ? "team.member_added" : "team.member_role_changed",
        entityId: input.teamId,
        entityType: "team",
        diff: { [input.userId]: [before?.role ?? null, input.role] },
      })
      yield* teamsEvent
    }),
})

export const removeTeamMember = Command.make("team.member_removed", {
  input: RemoveTeamMemberInput,
  output: Schema.Void,
  authorize: (input) => authorizeTeamMembership(input.teamId),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const removed = yield* db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)))
        .returning({ role: teamMembers.role })
      if (removed.length === 0)
        return yield* new NotFound({ entity: "team member", id: input.userId })
      yield* authz.rebuild({ userId: input.userId })
      yield* record({
        action: "team.member_removed",
        entityId: input.teamId,
        entityType: "team",
        diff: { [input.userId]: [removed[0]!.role, null] },
      })
      yield* teamsEvent
    }),
})
