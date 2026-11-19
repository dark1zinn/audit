import {
  accessEntries,
  account,
  boardColumns,
  calendars,
  channelMembers,
  entities,
  eventAttendees,
  events,
  notificationPrefs,
  projects,
  notifications,
  passkey,
  pushSubscriptions,
  reactions,
  recentItems,
  savedFilters,
  savedMessages,
  session,
  taskAssignees,
  tasks,
  teamMembers,
  threadFollowers,
  twoFactor,
  user,
  userProfiles,
  verification,
  watchers,
  workspaceMembers,
} from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { Conflict, Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { type EntityId, type UserId, UserId as UserIdSchema } from "@audit/domain/ids"
import { PersonalExport, TransferOwnershipInput } from "@audit/domain/people/schema"
import type { WorkspaceCapability } from "@audit/domain/permissions"
import { Db } from "@audit/platform/database"
import { and, eq, inArray, notInArray, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { softDeleteEntity, touchEntity } from "../entities.ts"
import { record, emit } from "../trail.ts"
import { buildPersonalExport } from "./export.ts"

const requireCapability = (capability: WorkspaceCapability) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability(capability)
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
      })
      .from(workspaceMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, workspaceMembers.userId))
      .where(eq(workspaceMembers.userId, userId))
      .for("update")
    if (member === undefined) return yield* new NotFound({ entity: "member", id: userId })
    return member
  })

const currentOwner = Effect.gen(function* () {
  const db = yield* Db
  const [owner] = yield* db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.role, "owner"))
    .for("update")
  if (owner === undefined) return yield* new NotFound({ entity: "owner", id: "workspace" })
  return owner.userId as UserId
})

/**
 * Hands the workspace to an active member. The previous owner becomes an admin; the caller holds
 * `workspace.transfer` (owner-only), so the outgoing owner is whoever currently holds the role.
 */
export const transferOwnership = Command.make("people.transferOwnership", {
  input: TransferOwnershipInput,
  output: Schema.Void,
  authorize: () => requireCapability("workspace.transfer"),
  run: ({ userId }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const actorId = actorUserId(yield* CurrentActor)
      const previousOwnerId = yield* currentOwner
      if (previousOwnerId === userId) {
        return yield* new ValidationError({
          message: "This member already owns the workspace",
          field: "userId",
        })
      }
      const target = yield* loadMember(userId)
      if (target.deactivatedAt !== null) {
        return yield* new Conflict({
          message: "Deactivated members cannot own the workspace",
        })
      }
      yield* db
        .update(workspaceMembers)
        .set({ role: "owner" })
        .where(eq(workspaceMembers.userId, userId))
      yield* db
        .update(workspaceMembers)
        .set({ role: "admin" })
        .where(eq(workspaceMembers.userId, previousOwnerId))
      yield* authz.rebuild({ userId })
      yield* authz.rebuild({ userId: previousOwnerId })
      yield* record({
        action: "workspace.ownership_transferred",
        entityId: userId,
        entityType: "user",
        details: { previousOwnerId },
      })
      yield* memberEvent(userId, actorId)
      yield* memberEvent(previousOwnerId, actorId)
    }),
})

/**
 * Removes a member from the workspace and anonymises them. The `user` row survives because
 * trail, comments, and messages reference it; personal state is deleted outright. Open tasks
 * move to the owner so nothing is left unassigned.
 */
export const deleteMember = Command.make("people.deleteMember", {
  input: UserIdSchema,
  output: Schema.Void,
  authorize: () => requireCapability("members.delete"),
  run: (userId) =>
    Effect.gen(function* () {
      const db = yield* Db
      const authz = yield* Authz
      const actorId = actorUserId(yield* CurrentActor)
      const member = yield* loadMember(userId)
      if (actorId === userId) {
        return yield* new Forbidden({
          action: "people.deleteMember",
          message: "You cannot delete your own account",
        })
      }
      if (member.role === "owner") {
        return yield* new Conflict({
          message: "Transfer ownership before deleting the owner",
        })
      }
      const ownerId = yield* currentOwner

      const openTaskIds = (yield* db
        .select({ taskId: taskAssignees.taskId })
        .from(taskAssignees)
        .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
        .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
        .innerJoin(entities, eq(entities.id, tasks.id))
        .where(
          and(
            eq(taskAssignees.userId, userId),
            notInArray(boardColumns.category, ["done", "canceled"]),
            isNull(entities.deletedAt),
          ),
        )).map((row) => row.taskId)
      if (openTaskIds.length > 0) {
        yield* db
          .insert(taskAssignees)
          .values(openTaskIds.map((taskId) => ({ taskId, userId: ownerId })))
          .onConflictDoNothing()
      }

      const ownedCalendars = (yield* db
        .select({ id: calendars.id })
        .from(calendars)
        .where(eq(calendars.ownerUserId, userId))).map((row) => row.id as EntityId)
      const ownedEvents =
        ownedCalendars.length === 0
          ? []
          : (yield* db
              .select({ id: events.id })
              .from(events)
              .where(inArray(events.calendarId, ownedCalendars))).map((row) => row.id as EntityId)
      for (const id of [...ownedCalendars, ...ownedEvents]) {
        yield* softDeleteEntity(id)
      }

      yield* db.delete(session).where(eq(session.userId, userId))
      yield* db.delete(account).where(eq(account.userId, userId))
      yield* db.delete(passkey).where(eq(passkey.userId, userId))
      yield* db.delete(twoFactor).where(eq(twoFactor.userId, userId))
      yield* db.delete(verification).where(eq(verification.value, userId))
      yield* db.delete(notifications).where(eq(notifications.userId, userId))
      yield* db.delete(notificationPrefs).where(eq(notificationPrefs.userId, userId))
      yield* db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
      yield* db.delete(savedFilters).where(eq(savedFilters.userId, userId))
      yield* db.delete(recentItems).where(eq(recentItems.userId, userId))
      yield* db.delete(watchers).where(eq(watchers.userId, userId))
      yield* db.delete(threadFollowers).where(eq(threadFollowers.userId, userId))
      yield* db.delete(savedMessages).where(eq(savedMessages.userId, userId))
      yield* db.delete(reactions).where(eq(reactions.userId, userId))
      yield* db.delete(channelMembers).where(eq(channelMembers.userId, userId))
      if (openTaskIds.length > 0) {
        yield* db
          .delete(taskAssignees)
          .where(and(eq(taskAssignees.userId, userId), inArray(taskAssignees.taskId, openTaskIds)))
      }
      yield* db.update(projects).set({ leadUserId: null }).where(eq(projects.leadUserId, userId))
      yield* db
        .delete(eventAttendees)
        .where(
          and(eq(eventAttendees.principalType, "user"), eq(eventAttendees.principalId, userId)),
        )
      yield* db
        .delete(accessEntries)
        .where(and(eq(accessEntries.principalType, "user"), eq(accessEntries.principalId, userId)))
      yield* db.delete(teamMembers).where(eq(teamMembers.userId, userId))
      yield* db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId))

      const deletedAt = new Date()
      yield* db
        .update(user)
        .set({
          name: "Deleted member",
          email: `deleted+${userId}@invalid`,
          image: null,
          emailVerified: false,
          twoFactorEnabled: false,
        })
        .where(eq(user.id, userId))
      yield* db
        .update(userProfiles)
        .set({
          displayName: "Deleted member",
          title: null,
          timezone: "UTC",
          locale: null,
          quietStart: null,
          quietEnd: null,
          avatarFileId: null,
          icalTokenHash: null,
          deactivatedAt: deletedAt,
          deletedAt,
        })
        .where(eq(userProfiles.userId, userId))
      yield* touchEntity(userId, { title: "Deleted member", searchText: "" })

      yield* authz.rebuild({ userId })
      yield* record({
        action: "member.deleted",
        entityId: userId,
        entityType: "user",
        details: { reassignedTaskCount: openTaskIds.length },
      })
      yield* memberEvent(userId, actorId)
    }),
})

/** The caller's own data, as a downloadable bundle. Records a `me.exported` trail entry. */
export const exportMine = Command.make("people.exportMine", {
  input: Schema.Void,
  output: PersonalExport,
  authorize: () => Effect.void,
  run: () =>
    Effect.gen(function* () {
      const userId = yield* currentUser("people.exportMine")
      const bundle = yield* buildPersonalExport(userId)
      yield* record({ action: "me.exported", entityId: userId, entityType: "user" })
      return bundle
    }),
})
