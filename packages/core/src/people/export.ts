/**
 * The signed-in person's own data. Shared content (tasks, comments, messages, events) is filtered
 * through `authz.visible`, so nothing the person can no longer see leaks out.
 */
import {
  comments,
  entities,
  events,
  messages,
  notificationPrefs,
  projects,
  taskAssignees,
  tasks,
  trailEvents,
  user,
  userProfiles,
  workspaceMembers,
} from "@audit/db/schema"
import { NotFound } from "@audit/domain/errors"
import type { UserId } from "@audit/domain/ids"
import type { PersonalExport } from "@audit/domain/people/schema"
import { Db } from "@audit/platform/database"
import { and, asc, eq, isNull, or, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"

export const buildPersonalExport = (userId: UserId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const authz = yield* Authz
    const visible = yield* authz.visible(sql`${entities.id}`)

    const [profile] = yield* db
      .select({
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        displayName: userProfiles.displayName,
        title: userProfiles.title,
        timezone: userProfiles.timezone,
        locale: userProfiles.locale,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(user)
      .innerJoin(userProfiles, eq(userProfiles.userId, user.id))
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, user.id))
      .where(eq(user.id, userId))
    if (profile === undefined) return yield* new NotFound({ entity: "member", id: userId })

    const prefs = yield* db
      .select({
        kind: notificationPrefs.kind,
        channel: notificationPrefs.channel,
        enabled: notificationPrefs.enabled,
      })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId))

    const assignedToMe = sql<boolean>`exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${userId})`
    const taskRows = yield* db
      .select({
        id: tasks.id,
        key: sql<string>`${projects.key} || '-' || ${tasks.number}`,
        title: entities.title,
        createdBy: entities.createdBy,
        createdAt: entities.createdAt,
        assignedToMe,
      })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(isNull(entities.deletedAt), visible, or(eq(entities.createdBy, userId), assignedToMe)),
      )
      .orderBy(asc(entities.createdAt))

    const commentRows = yield* db
      .select({
        id: comments.id,
        targetId: comments.targetId,
        bodyText: comments.bodyText,
        createdAt: entities.createdAt,
        editedAt: comments.editedAt,
      })
      .from(comments)
      .innerJoin(entities, eq(entities.id, comments.id))
      .where(and(eq(comments.authorId, userId), isNull(entities.deletedAt), visible))
      .orderBy(asc(entities.createdAt))

    const messageRows = yield* db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        bodyText: messages.bodyText,
        createdAt: entities.createdAt,
        editedAt: messages.editedAt,
      })
      .from(messages)
      .innerJoin(entities, eq(entities.id, messages.id))
      .where(
        and(
          eq(messages.authorId, userId),
          isNull(messages.deletedAt),
          isNull(entities.deletedAt),
          visible,
        ),
      )
      .orderBy(asc(entities.createdAt))

    const eventRows = yield* db
      .select({
        id: events.id,
        calendarId: events.calendarId,
        title: entities.title,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        allDay: events.allDay,
        timezone: events.timezone,
        location: events.location,
        description: events.description,
        createdAt: entities.createdAt,
      })
      .from(events)
      .innerJoin(entities, eq(entities.id, events.id))
      .where(and(eq(entities.createdBy, userId), isNull(entities.deletedAt), visible))
      .orderBy(asc(entities.createdAt))

    const trailRows = yield* db
      .select({
        at: trailEvents.at,
        action: trailEvents.action,
        entityType: trailEvents.entityType,
        entityId: trailEvents.entityId,
      })
      .from(trailEvents)
      .where(and(eq(trailEvents.actorType, "user"), eq(trailEvents.actorId, userId)))
      .orderBy(asc(trailEvents.seq))

    const bundle: PersonalExport = {
      exportedAt: new Date(),
      profile: { userId, ...profile },
      notificationPrefs: prefs,
      tasks: taskRows.map((row) => ({
        id: row.id,
        key: row.key,
        title: row.title,
        createdByMe: row.createdBy === userId,
        assignedToMe: row.assignedToMe,
        createdAt: row.createdAt,
      })),
      comments: commentRows,
      messages: messageRows,
      events: eventRows,
      trail: trailRows,
    }
    return bundle
  })
