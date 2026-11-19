/**
 * The one place that decides who may do what. Every command and query calls it.
 */
import { entities, userProfiles, workspace, workspaceMembers } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Forbidden, NotFound } from "@audit/domain/errors"
import type { EntityId, UserId } from "@audit/domain/ids"
import {
  aiCapabilities,
  hasCapability,
  minimumRole,
  type ResourceAction,
  type WorkspaceCapability,
} from "@audit/domain/permissions"
import { type ResourceRole, roleAtLeast, type WorkspaceRole } from "@audit/domain/roles"
import { Db } from "@audit/platform/database"
import { and, eq, isNull, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { type RebuildScope, rebuildContainerAccess, roleOnEntity, visibleTo } from "./access.ts"

export interface AuthzShape {
  /** Workspace role of an active member, `null` for strangers and deactivated people. */
  readonly workspaceRole: (userId: UserId) => Effect.Effect<WorkspaceRole | null>
  readonly roleOn: (userId: UserId, entityId: EntityId) => Effect.Effect<ResourceRole | null>
  /**
   * Fails with `NotFound` when the actor cannot see the entity (so its existence does not leak) and
   * with `Forbidden` when they can see it but lack the role for `action`.
   */
  readonly requireOn: (
    action: ResourceAction,
    entityId: EntityId,
  ) => Effect.Effect<void, Forbidden | NotFound, CurrentActor>
  readonly requireCapability: (
    capability: WorkspaceCapability,
  ) => Effect.Effect<void, Forbidden, CurrentActor>
  readonly can: (
    action: ResourceAction,
    entityId: EntityId,
  ) => Effect.Effect<boolean, never, CurrentActor>
  /** SQL condition: `idColumn` is an entity the actor can see. The system sees everything. */
  readonly visible: (idColumn: SQL) => Effect.Effect<SQL, never, CurrentActor>
  /** Rebuilds materialised container access; run in the transaction that changed grants. */
  readonly rebuild: (scope: RebuildScope) => Effect.Effect<void>
}

export class Authz extends Context.Service<Authz, AuthzShape>()("@audit/core/Authz") {
  static readonly layer = Layer.effect(
    Authz,
    Effect.gen(function* () {
      const db = yield* Db

      const workspaceRole = (userId: UserId) =>
        db
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .innerJoin(userProfiles, eq(userProfiles.userId, workspaceMembers.userId))
          .where(and(eq(workspaceMembers.userId, userId), isNull(userProfiles.deactivatedAt)))
          .pipe(
            Effect.map((rows) => rows[0]?.role ?? null),
            Effect.orDie,
          )

      const roleOn = (userId: UserId, entityId: EntityId) =>
        db.execute<{ role: ResourceRole }>(roleOnEntity(userId, entityId)).pipe(
          Effect.map((result) => result.rows[0]?.role ?? null),
          Effect.orDie,
        )

      const entityExists = (entityId: EntityId) =>
        db
          .select({ id: entities.id })
          .from(entities)
          .where(and(eq(entities.id, entityId), isNull(entities.deletedAt)))
          .pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          )

      const requireOn = (action: ResourceAction, entityId: EntityId) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor
          const userId = actorUserId(actor)
          if (userId === null) {
            if (yield* entityExists(entityId)) return
            return yield* new NotFound({ entity: "entity", id: entityId })
          }
          const role = yield* roleOn(userId, entityId)
          if (role === null || !(yield* entityExists(entityId))) {
            return yield* new NotFound({ entity: "entity", id: entityId })
          }
          if (!roleAtLeast(role, minimumRole(action))) {
            return yield* new Forbidden({
              action,
              message: `${action} needs the ${minimumRole(action)} role`,
            })
          }
        })

      const requireCapability = (capability: WorkspaceCapability) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor
          if (actor._tag === "system") return
          if (actor._tag === "ai" && aiCapabilities[capability] !== true) {
            return yield* new Forbidden({ action: capability, message: "Not available to the AI" })
          }
          const role = yield* workspaceRole(actorUserId(actor) as UserId)
          if (role === null || !hasCapability(role, capability)) {
            return yield* new Forbidden({
              action: capability,
              message: `${capability} is not allowed`,
            })
          }
          if (capability === "invites.create" && role === "member") {
            const [row] = yield* db
              .select({ settings: workspace.settings })
              .from(workspace)
              .pipe(Effect.orDie)
            const settings = row?.settings as { membersCanInvite?: boolean } | undefined
            if (settings?.membersCanInvite !== true) {
              return yield* new Forbidden({
                action: capability,
                message: "Members may not invite people in this workspace",
              })
            }
          }
        })

      return Authz.of({
        workspaceRole,
        roleOn,
        requireOn,
        requireCapability,
        can: (action, entityId) =>
          requireOn(action, entityId).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        visible: (idColumn) =>
          Effect.gen(function* () {
            const userId = actorUserId(yield* CurrentActor)
            return userId === null ? sql`true` : visibleTo(userId, idColumn)
          }),
        rebuild: (scope) =>
          Effect.forEach(rebuildContainerAccess(scope), (statement) => db.execute(statement), {
            discard: true,
          }).pipe(Effect.orDie),
      })
    }),
  )
}
