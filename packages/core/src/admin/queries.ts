/**
 * Admin reads: the overview, storage, email status, and the access review (who can reach an
 * entity, and what one person can reach). The access review uses the same grant tables that
 * `access.ts` materialises from; it only reads them.
 */
import {
  accessEntries,
  entities,
  files,
  invites,
  teamMembers,
  teams,
  trailEvents,
  workspace,
  workspaceMembers,
} from "@audit/db/schema"
import { NotFound } from "@audit/domain/errors"
import type { EntityId, UserId } from "@audit/domain/ids"
import {
  defaultWorkspaceSettings,
  type SignupPolicy,
  type WorkspaceSettings,
} from "@audit/domain/identity/schema"
import type { ResourceRole } from "@audit/domain/roles"
import { Db } from "@audit/platform/database"
import { and, count, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"
import { fileLimits } from "../files/queries.ts"
import { Mailer } from "../notifications/mail.ts"
import { writeTrail } from "../trail.ts"

const storageSummary = Effect.gen(function* () {
  const db = yield* Db
  const limits = yield* fileLimits
  const [orphans] = yield* db
    .select({ n: count() })
    .from(files)
    .where(isNotNull(files.unreferencedAt))
    .pipe(Effect.orDie)
  const [soft] = yield* db
    .select({ n: count() })
    .from(files)
    .innerJoin(entities, eq(entities.id, files.id))
    .where(isNotNull(entities.deletedAt))
    .pipe(Effect.orDie)
  return {
    usedBytes: limits.usedBytes,
    quotaBytes: limits.quotaBytes,
    uploadLimitBytes: limits.uploadLimitBytes,
    orphanedFiles: orphans?.n ?? 0,
    softDeletedFiles: soft?.n ?? 0,
  }
})

export const storage = Effect.gen(function* () {
  const authz = yield* Authz
  yield* authz.requireCapability("workspace.settings")
  return yield* storageSummary
})

export const emailStatus = Effect.gen(function* () {
  const authz = yield* Authz
  yield* authz.requireCapability("workspace.settings")
  const mailer = yield* Mailer
  return { enabled: mailer.enabled }
})

export const overview = Effect.gen(function* () {
  const authz = yield* Authz
  yield* authz.requireCapability("workspace.settings")
  const db = yield* Db
  const mailer = yield* Mailer

  const [ws] = yield* db
    .select({ settings: workspace.settings, signupPolicy: workspace.signupPolicy })
    .from(workspace)
    .where(eq(workspace.id, 1))
    .pipe(Effect.orDie)
  const settings: WorkspaceSettings = {
    ...defaultWorkspaceSettings,
    ...(ws?.settings as Partial<WorkspaceSettings> | undefined),
  }

  const rows = yield* db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .pipe(Effect.orDie)
  const roles = yield* Effect.forEach(rows, (row) => authz.workspaceRole(row.userId as UserId))
  const active = roles.filter((role) => role !== null)

  const [pending] = yield* db
    .select({ n: count() })
    .from(invites)
    .where(
      and(
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date()),
        sql`${invites.useCount} < ${invites.maxUses}`,
      ),
    )
    .pipe(Effect.orDie)
  const [trail] = yield* db.select({ n: count() }).from(trailEvents).pipe(Effect.orDie)

  return {
    members: active.length,
    owners: active.filter((role) => role === "owner").length,
    admins: active.filter((role) => role === "admin").length,
    pendingInvites: pending?.n ?? 0,
    trailEvents: trail?.n ?? 0,
    emailEnabled: mailer.enabled,
    signupPolicy: ws?.signupPolicy as SignupPolicy,
    breachedPasswordCheck: settings.breachedPasswordCheck === true,
    storage: yield* storageSummary,
  }
})

/** One grant row, joined with the entity it grants access to. */
const grantColumns = {
  entityId: entities.id,
  entityTitle: entities.title,
  entityType: entities.type,
  principalType: accessEntries.principalType,
  principalId: accessEntries.principalId,
  principalRole: accessEntries.principalRole,
  role: accessEntries.role,
}

const toGrant = (
  row: {
    entityId: string
    entityTitle: string
    entityType: string
    principalType: "user" | "team" | "role"
    principalId: string | null
    principalRole: "owner" | "admin" | "member" | "guest" | null
    role: string
  },
  source: "direct" | "team" | "role" | "inherited",
) => ({
  entityId: row.entityId as EntityId,
  entityTitle: row.entityTitle,
  entityType: row.entityType,
  principalType: row.principalType,
  principalId: row.principalId,
  principalRole: row.principalRole,
  role: row.role as ResourceRole,
  source,
})

export const accessItem = (entityId: EntityId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("access.override")
    yield* writeTrail({ action: "admin.access_inspected", entityId, entityType: "entity" })
    const db = yield* Db

    const [entity] = yield* db
      .select({
        title: entities.title,
        type: entities.type,
        parentId: entities.parentId,
        restricted: entities.restricted,
      })
      .from(entities)
      .where(and(eq(entities.id, entityId), isNull(entities.deletedAt)))
      .pipe(Effect.orDie)
    if (entity === undefined) return yield* new NotFound({ entity: "entity", id: entityId })

    // Restricted entities inherit nothing; otherwise grants flow down from ancestors up to a restricted one.
    const ancestorIds: string[] = []
    let next: string | null = entity.restricted ? null : entity.parentId
    while (next !== null) {
      const [ancestor] = yield* db
        .select({ id: entities.id, parentId: entities.parentId, restricted: entities.restricted })
        .from(entities)
        .where(and(eq(entities.id, next), isNull(entities.deletedAt)))
        .pipe(Effect.orDie)
      if (ancestor === undefined) break
      ancestorIds.push(ancestor.id)
      next = ancestor.restricted ? null : ancestor.parentId
    }

    const grants = yield* db
      .select(grantColumns)
      .from(accessEntries)
      .innerJoin(entities, eq(entities.id, accessEntries.resourceId))
      .where(inArray(accessEntries.resourceId, [entityId, ...ancestorIds]))
      .pipe(Effect.orDie)

    const members = yield* db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .pipe(Effect.orDie)
    const effective: Array<{ userId: UserId; role: ResourceRole }> = []
    for (const member of members) {
      const userId = member.userId as UserId
      const role = yield* authz.roleOn(userId, entityId)
      if (role !== null) effective.push({ userId, role })
    }

    return {
      entityId,
      entityTitle: entity.title,
      entityType: entity.type,
      restricted: entity.restricted,
      grants: grants.map((row) => {
        if (row.entityId !== entityId) return toGrant(row, "inherited")
        return toGrant(row, row.principalType === "user" ? "direct" : row.principalType)
      }),
      effective,
    }
  })

export const accessPerson = (userId: UserId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("access.override")
    yield* writeTrail({ action: "admin.access_inspected", entityId: userId, entityType: "user" })
    const db = yield* Db

    const workspaceRole = yield* authz.workspaceRole(userId)
    const memberTeams = yield* db
      .select({ teamId: teamMembers.teamId, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, userId))
      .pipe(Effect.orDie)
    const teamIds = memberTeams.map((team) => team.teamId)
    const teamNames = new Map(memberTeams.map((team) => [team.teamId, team.name]))

    const reaches = or(
      and(eq(accessEntries.principalType, "user"), eq(accessEntries.principalId, userId)),
      teamIds.length > 0
        ? and(eq(accessEntries.principalType, "team"), inArray(accessEntries.principalId, teamIds))
        : undefined,
      workspaceRole !== null
        ? and(
            eq(accessEntries.principalType, "role"),
            eq(accessEntries.principalRole, workspaceRole),
          )
        : undefined,
    )
    const grants = yield* db
      .select({ ...grantColumns, restricted: entities.restricted })
      .from(accessEntries)
      .innerJoin(entities, eq(entities.id, accessEntries.resourceId))
      .where(and(isNull(entities.deletedAt), reaches))
      .pipe(Effect.orDie)

    // A grant on an item with live children is a container grant: it flows down to them, except
    // restricted children, which inherit nothing.
    const granted = [...new Set(grants.map((row) => row.entityId))]
    let children: Array<{ parentId: string | null; restricted: boolean }> = []
    if (granted.length > 0) {
      children = yield* db
        .select({ parentId: entities.parentId, restricted: entities.restricted })
        .from(entities)
        .where(and(isNull(entities.deletedAt), inArray(entities.parentId, granted)))
        .pipe(Effect.orDie)
    }
    const tallies = new Map<string, { total: number; restricted: number }>()
    for (const child of children) {
      if (child.parentId === null) continue
      const tally = tallies.get(child.parentId) ?? { total: 0, restricted: 0 }
      tally.total += 1
      if (child.restricted) tally.restricted += 1
      tallies.set(child.parentId, tally)
    }

    return {
      userId,
      workspaceRole,
      grants: grants.map((row) => {
        const tally = tallies.get(row.entityId) ?? { total: 0, restricted: 0 }
        return {
          ...toGrant(row, row.principalType === "user" ? "direct" : row.principalType),
          teamName:
            row.principalType === "team" && row.principalId !== null
              ? (teamNames.get(row.principalId) ?? null)
              : null,
          restricted: row.restricted,
          scope: tally.total > 0 ? ("container" as const) : ("own" as const),
          restrictedChildren: tally.restricted,
        }
      }),
    }
  })
