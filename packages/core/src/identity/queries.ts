import {
  invites,
  teamMembers,
  teams,
  user,
  userProfiles,
  workspace,
  workspaceMembers,
} from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Forbidden, NotFound, Unauthorized } from "@audit/domain/errors"
import type { InviteId, ProjectId, TeamId, UserId } from "@audit/domain/ids"
import {
  defaultWorkspaceSettings,
  type Invite,
  type InvitePreview,
  type InviteStatus,
  type Locale,
  type Me,
  type Member,
  type SignupPolicy,
  type Team,
  type TeamMember,
  type Workspace,
  type WorkspaceSettings,
} from "@audit/domain/identity/schema"
import { sha256Hex } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { asc, count, desc, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"

type InviteRow = typeof invites.$inferSelect

export const inviteStatus = (row: InviteRow, now: Date): InviteStatus => {
  if (row.revokedAt !== null) return "revoked"
  if (row.useCount >= row.maxUses) return "used"
  if (row.expiresAt <= now) return "expired"
  return "active"
}

export const toInvite = (row: InviteRow, now: Date): Invite => ({
  id: row.id as InviteId,
  email: row.email,
  role: row.role,
  teamIds: row.teamIds as unknown as ReadonlyArray<TeamId>,
  projectGrants: row.projectGrants.map((g) => ({
    projectId: g.projectId as ProjectId,
    role: g.role,
  })),
  expiresAt: row.expiresAt,
  maxUses: row.maxUses,
  useCount: row.useCount,
  revokedAt: row.revokedAt,
  createdBy: row.createdBy as UserId,
  note: row.note,
  createdAt: row.createdAt,
  status: inviteStatus(row, now),
})

const readSettings = (raw: unknown): WorkspaceSettings => ({
  ...defaultWorkspaceSettings,
  ...(raw as Partial<WorkspaceSettings>),
})

export const setupStatus = Effect.gen(function* () {
  const db = yield* Db
  const rows = yield* db.select({ id: workspace.id }).from(workspace)
  return { needsSetup: rows.length === 0 }
}).pipe(Effect.orDie)

export const getWorkspace = Effect.gen(function* () {
  const authz = yield* Authz
  yield* authz.requireCapability("workspace.settings")
  const db = yield* Db
  const [row] = yield* db.select().from(workspace).pipe(Effect.orDie)
  if (row === undefined) return yield* new Forbidden({ action: "workspace", message: "Not set up" })
  return {
    name: row.name,
    settings: readSettings(row.settings),
    signupPolicy: row.signupPolicy as SignupPolicy,
    searchConfig: row.searchConfig as Workspace["searchConfig"],
  } satisfies Workspace
})

export const getMe = Effect.gen(function* () {
  const db = yield* Db
  const userId = actorUserId(yield* CurrentActor)
  if (userId === null) return yield* new Unauthorized({ message: "No user session" })
  const [row] = yield* db
    .select({
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
      displayName: userProfiles.displayName,
      title: userProfiles.title,
      timezone: userProfiles.timezone,
      locale: userProfiles.locale,
      role: workspaceMembers.role,
    })
    .from(user)
    .innerJoin(userProfiles, eq(userProfiles.userId, user.id))
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, user.id))
    .where(eq(user.id, userId))
    .pipe(Effect.orDie)
  const [ws] = yield* db.select().from(workspace).pipe(Effect.orDie)
  if (row === undefined || ws === undefined) {
    return yield* new Unauthorized({ message: "Not a member of this workspace" })
  }
  const settings = readSettings(ws.settings)
  return {
    userId,
    email: row.email,
    displayName: row.displayName,
    title: row.title,
    role: row.role,
    timezone: row.timezone,
    locale: row.locale as Locale | null,
    twoFactorEnabled: row.twoFactorEnabled === true,
    workspace: {
      name: ws.name,
      defaultLocale: settings.defaultLocale,
      defaultTheme: settings.defaultTheme,
      accentColor: settings.accentColor,
      membersCanInvite: settings.membersCanInvite,
    },
  } satisfies Me
})

/** Every member sees the directory; emails and security details only for admins. */
export const listMembers = Effect.gen(function* () {
  const db = yield* Db
  const authz = yield* Authz
  const isAdmin = yield* authz.requireCapability("members.manage").pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
  const rows = yield* db
    .select({
      userId: user.id,
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
      displayName: userProfiles.displayName,
      title: userProfiles.title,
      lastSeenAt: userProfiles.lastSeenAt,
      deactivatedAt: userProfiles.deactivatedAt,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .innerJoin(userProfiles, eq(userProfiles.userId, workspaceMembers.userId))
    .orderBy(asc(userProfiles.displayName))
    .pipe(Effect.orDie)
  return rows.map((row): Member => ({
    userId: row.userId as UserId,
    email: isAdmin ? row.email : "",
    displayName: row.displayName,
    title: row.title,
    role: row.role,
    twoFactorEnabled: isAdmin ? row.twoFactorEnabled === true : false,
    joinedAt: row.joinedAt,
    lastSeenAt: isAdmin ? row.lastSeenAt : null,
    deactivatedAt: row.deactivatedAt,
  }))
})

export const listInvites = Effect.gen(function* () {
  const authz = yield* Authz
  yield* authz.requireCapability("invites.manage")
  const db = yield* Db
  const rows = yield* db.select().from(invites).orderBy(desc(invites.createdAt)).pipe(Effect.orDie)
  const now = new Date()
  return rows.map((row) => toInvite(row, now))
})

export const previewInvite = (token: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, sha256Hex(token)))
      .pipe(Effect.orDie)
    const [ws] = yield* db.select({ name: workspace.name }).from(workspace).pipe(Effect.orDie)
    if (row === undefined || ws === undefined || inviteStatus(row, new Date()) !== "active") {
      return yield* new NotFound({ entity: "invite", id: "token" })
    }
    return {
      workspaceName: ws.name,
      email: row.email,
      role: row.role,
      expiresAt: row.expiresAt,
    } satisfies InvitePreview
  })

export const listTeams = Effect.gen(function* () {
  const db = yield* Db
  const rows = yield* db
    .select({
      id: teams.id,
      name: teams.name,
      slug: teams.slug,
      kind: teams.kind,
      projectId: teams.projectId,
      memberCount: count(teamMembers.userId),
    })
    .from(teams)
    .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .groupBy(teams.id)
    .orderBy(asc(teams.name))
    .pipe(Effect.orDie)
  return rows.map((row): Team => ({
    id: row.id as TeamId,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    projectId: row.projectId as ProjectId | null,
    memberCount: row.memberCount,
  }))
})

export const listTeamMembers = (teamId: TeamId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [team] = yield* db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, teamId))
      .pipe(Effect.orDie)
    if (team === undefined) return yield* new NotFound({ entity: "team", id: teamId })
    const rows = yield* db
      .select({
        userId: teamMembers.userId,
        role: teamMembers.role,
        displayName: userProfiles.displayName,
      })
      .from(teamMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId))
      .orderBy(asc(userProfiles.displayName))
      .pipe(Effect.orDie)
    return rows.map((row): TeamMember => ({
      userId: row.userId as UserId,
      displayName: row.displayName,
      role: row.role,
    }))
  })
