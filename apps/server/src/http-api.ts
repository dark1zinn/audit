/**
 * HTTP handlers: decode, then call a command (writes) or a query (reads). They never touch the
 * database themselves.
 */
import { Authz } from "@audit/core/authz"
import { EventBus } from "@audit/core/event-bus"
import * as identity from "@audit/core/identity/commands"
import * as identityQueries from "@audit/core/identity/queries"
import * as docCommands from "@audit/core/docs/commands"
import * as docComments from "@audit/core/docs/comments"
import * as docQueries from "@audit/core/docs/queries"
import { backlinks, resolveEntities } from "@audit/core/references"
import * as projectCommands from "@audit/core/projects/commands"
import * as projectQueries from "@audit/core/projects/queries"
import * as calendarCommands from "@audit/core/calendar/commands"
import * as calendarQueries from "@audit/core/calendar/queries"
import { RequestMeta } from "@audit/core/request"
import { listTrail, verifyTrail } from "@audit/core/trail-queries"
import * as taskCommands from "@audit/core/tasks/commands"
import * as taskQueries from "@audit/core/tasks/queries"
import * as notificationCommands from "@audit/core/notifications/commands"
import * as notificationQueries from "@audit/core/notifications/queries"
import * as searchQueries from "@audit/core/search/queries"
import { recordRecent } from "@audit/core/search/recent"
import { reindexStatus, requestReindex } from "@audit/core/search/reindex"
import type { Mailer } from "@audit/core/notifications/mail"
import type { PushTransport } from "@audit/core/notifications/push"
import * as chatCommands from "@audit/core/chat/commands"
import * as chatQueries from "@audit/core/chat/queries"
import * as peopleCommands from "@audit/core/people/commands"
import * as chatThreadDoc from "@audit/core/chat/thread-doc"
import * as adminCommands from "@audit/core/admin/commands"
import * as adminQueries from "@audit/core/admin/queries"
import * as maintenance from "@audit/core/admin/maintenance"
import * as adminSignup from "@audit/core/admin/signup"
import * as aiCommands from "@audit/core/ai/commands"
import * as aiQueries from "@audit/core/ai/queries"
import * as aiConversations from "@audit/core/ai/conversations"
import * as aiProposals from "@audit/core/ai/proposals"
import { runAiAction } from "@audit/core/ai/actions"
import { currentUser } from "@audit/core/current-user"
import { CurrentActor } from "@audit/domain/actor"
import { AuditApi } from "@audit/domain/api"
import { Forbidden, Unauthorized } from "@audit/domain/errors"
import { Authentication } from "@audit/domain/http"
import { AppConfig } from "@audit/platform/config"
import type { AiModels } from "@audit/core/ai/models"
import type { Secrets } from "@audit/platform/crypto"
import type { Jobs } from "@audit/platform/jobs"
import type { HttpClient } from "effect/http/HttpClient"
import { Db } from "@audit/platform/database"
import pkg from "../package.json" with { type: "json" }
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { CLIENT_IP_HEADER } from "./client-ip.ts"
import { RateLimiter } from "./rate-limit.ts"
import { Sessions } from "./sessions.ts"
import { SetupToken } from "./setup-token.ts"

/** Services every command and query may need, captured once when the handlers are built. */
const coreContext = Effect.context<
  | Db
  | SqlClient.SqlClient
  | Authz
  | EventBus
  | AppConfig
  | PushTransport
  | Mailer
  | Secrets
  | AiModels
  | HttpClient
  | Jobs
>()

const systemActor = (reason: string) =>
  Effect.provideService(CurrentActor, { _tag: "system", reason } as const)

export const clientMeta = Effect.gen(function* () {
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

const CalendarLive = HttpApiBuilder.group(AuditApi, "calendar", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("calendars", () =>
        calendarQueries.listCalendars.execute({}).pipe(Effect.provide(core)),
      )
      .handle("createCalendar", ({ payload }) =>
        calendarCommands.createCalendar.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("updateCalendar", ({ params, payload }) =>
        calendarCommands.updateCalendar
          .execute({ calendarId: params.calendarId, patch: payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteCalendar", ({ params }) =>
        calendarCommands.deleteCalendar
          .execute({ calendarId: params.calendarId })
          .pipe(Effect.provide(core)),
      )
      .handle("events", ({ query }) =>
        calendarQueries.listEvents.execute(query).pipe(Effect.provide(core)),
      )
      .handle("createEvent", ({ params, payload }) =>
        calendarCommands.createEvent
          .execute({ ...payload, calendarId: params.calendarId })
          .pipe(Effect.provide(core)),
      )
      .handle("updateEvent", ({ params, payload }) =>
        calendarCommands.updateEvent
          .execute({ eventId: params.eventId, patch: payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteEvent", ({ params, payload }) =>
        calendarCommands.deleteEvent
          .execute({ eventId: params.eventId, patch: payload })
          .pipe(Effect.provide(core)),
      )
      .handle("rsvp", ({ params, payload }) =>
        calendarCommands.rsvp
          .execute({ eventId: params.eventId, response: payload.response })
          .pipe(Effect.provide(core)),
      )
      .handle("linkEvent", ({ params, payload }) =>
        calendarCommands.linkEvent
          .execute({ eventId: params.eventId, kind: payload.kind, targetId: payload.targetId })
          .pipe(Effect.provide(core)),
      )
      .handle("unlinkEvent", ({ params, payload }) =>
        calendarCommands.unlinkEvent
          .execute({ eventId: params.eventId, kind: payload.kind, targetId: payload.targetId })
          .pipe(Effect.provide(core)),
      )
      .handle("importIcs", ({ params, payload }) =>
        calendarCommands.importIcs
          .execute({ calendarId: params.calendarId, ics: payload.ics })
          .pipe(Effect.provide(core)),
      )
      .handle("regenerateIcalFeed", () =>
        calendarCommands.regenerateIcalFeed.execute({}).pipe(Effect.provide(core)),
      )
  }),
)

const ProjectsLive = HttpApiBuilder.group(AuditApi, "projects", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("list", () => projectQueries.sidebarProjects().pipe(Effect.provide(core)))
      .handle("adminList", () => projectQueries.adminProjects().pipe(Effect.provide(core)))
      .handle("create", ({ payload }) =>
        projectCommands.createProject.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("get", ({ params }) =>
        projectQueries.projectDetailFor(params.projectId).pipe(Effect.provide(core)),
      )
      .handle("update", ({ params, payload }) =>
        projectCommands.updateProject
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("archive", ({ params }) =>
        projectCommands.archiveProject
          .execute({ projectId: params.projectId })
          .pipe(Effect.provide(core)),
      )
      .handle("unarchive", ({ params }) =>
        projectCommands.unarchiveProject
          .execute({ projectId: params.projectId })
          .pipe(Effect.provide(core)),
      )
      .handle("delete", ({ params, payload }) =>
        projectCommands.deleteProject
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("restore", ({ params }) =>
        projectCommands.restoreProject
          .execute({ projectId: params.projectId })
          .pipe(Effect.provide(core)),
      )
      .handle("access", ({ params }) =>
        projectQueries.projectAccess(params.projectId).pipe(Effect.provide(core)),
      )
      .handle("grant", ({ params, payload }) =>
        projectCommands.grantProjectAccess
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("revoke", ({ params, payload }) =>
        projectCommands.revokeProjectAccess
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("setRestricted", ({ params, payload }) =>
        projectCommands.setProjectRestricted
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
  }),
)

const BoardsLive = HttpApiBuilder.group(AuditApi, "boards", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("list", ({ params }) =>
        projectQueries.projectBoards(params.projectId).pipe(Effect.provide(core)),
      )
      .handle("create", ({ params, payload }) =>
        projectCommands.createBoard
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("get", ({ params }) =>
        projectQueries.boardFor(params.boardId).pipe(Effect.provide(core)),
      )
      .handle("rename", ({ params, payload }) =>
        projectCommands.renameBoard
          .execute({ boardId: params.boardId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("delete", ({ params }) =>
        projectCommands.deleteBoard.execute({ boardId: params.boardId }).pipe(Effect.provide(core)),
      )
      .handle("setRestricted", ({ params, payload }) =>
        projectCommands.setBoardRestricted
          .execute({ boardId: params.boardId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("grant", ({ params, payload }) =>
        projectCommands.grantBoardAccess
          .execute({ boardId: params.boardId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("revoke", ({ params, payload }) =>
        projectCommands.revokeBoardAccess
          .execute({ boardId: params.boardId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("createColumn", ({ params, payload }) =>
        projectCommands.createColumn
          .execute({ boardId: params.boardId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("updateColumn", ({ params, payload }) =>
        projectCommands.updateColumn
          .execute({ columnId: params.columnId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("moveColumn", ({ params, payload }) =>
        projectCommands.moveColumn
          .execute({ columnId: params.columnId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteColumn", ({ params, payload }) =>
        projectCommands.deleteColumn
          .execute({ columnId: params.columnId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("labels", ({ params }) =>
        projectQueries.projectLabels(params.projectId).pipe(Effect.provide(core)),
      )
      .handle("createLabel", ({ params, payload }) =>
        projectCommands.createLabel
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("updateLabel", ({ params, payload }) =>
        projectCommands.updateLabel
          .execute({ labelId: params.labelId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteLabel", ({ params }) =>
        projectCommands.deleteLabel.execute({ labelId: params.labelId }).pipe(Effect.provide(core)),
      )
  }),
)

const TasksLive = HttpApiBuilder.group(AuditApi, "tasks", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("board", ({ params, query }) =>
        taskQueries.boardView(params.boardId, query).pipe(Effect.provide(core)),
      )
      .handle("list", ({ params, query }) =>
        taskQueries.listTasks(params.projectId, query).pipe(Effect.provide(core)),
      )
      .handle("calendar", ({ params, query }) =>
        taskQueries.calendarItems(params.projectId, query).pipe(Effect.provide(core)),
      )
      .handle("mine", () => taskQueries.myTasks().pipe(Effect.provide(core)))
      .handle("get", ({ params }) =>
        taskQueries.taskDetail(params.taskId).pipe(Effect.provide(core)),
      )
      .handle("byNumber", ({ params }) =>
        taskQueries.taskByNumber(params.projectId, params.number).pipe(Effect.provide(core)),
      )
      .handle("subtasks", ({ params }) =>
        taskQueries.subtasksOf(params.taskId).pipe(Effect.provide(core)),
      )
      .handle("create", ({ params, payload }) =>
        taskCommands.createTask
          .execute({ boardId: params.boardId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("update", ({ params, payload }) =>
        taskCommands.updateTask
          .execute({ taskId: params.taskId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("move", ({ params, payload }) =>
        taskCommands.moveTask
          .execute({ taskId: params.taskId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("delete", ({ params, payload }) =>
        taskCommands.deleteTask
          .execute({ taskId: params.taskId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("bulkMove", ({ payload }) =>
        taskCommands.bulkMoveTasks.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("bulkAssign", ({ payload }) =>
        taskCommands.bulkAssignTasks.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("bulkLabel", ({ payload }) =>
        taskCommands.bulkLabelTasks.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("bulkDelete", ({ payload }) =>
        taskCommands.bulkDeleteTasks.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("link", ({ params, payload }) =>
        taskCommands.linkTask
          .execute({ taskId: params.taskId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("unlink", ({ params, payload }) =>
        taskCommands.unlinkTask
          .execute({ taskId: params.taskId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("watch", ({ params }) =>
        taskCommands.watchTaskCommand.execute({ taskId: params.taskId }).pipe(Effect.provide(core)),
      )
      .handle("unwatch", ({ params }) =>
        taskCommands.unwatchTask.execute({ taskId: params.taskId }).pipe(Effect.provide(core)),
      )
      .handle("createComment", ({ params, payload }) =>
        taskCommands.createComment
          .execute({ taskId: params.taskId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("updateComment", ({ params, payload }) =>
        taskCommands.updateComment
          .execute({ commentId: params.commentId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteComment", ({ params }) =>
        taskCommands.deleteComment
          .execute({ commentId: params.commentId })
          .pipe(Effect.provide(core)),
      )
      .handle("savedFilters", ({ params }) =>
        taskQueries.savedFiltersOf(params.projectId).pipe(Effect.provide(core)),
      )
      .handle("createSavedFilter", ({ params, payload }) =>
        taskCommands.createSavedFilter
          .execute({ projectId: params.projectId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteSavedFilter", ({ params }) =>
        taskCommands.deleteSavedFilter
          .execute({ filterId: params.filterId })
          .pipe(Effect.provide(core)),
      )
  }),
)

const NotificationsLive = HttpApiBuilder.group(AuditApi, "notifications", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("list", ({ query }) =>
        notificationQueries.myNotifications(query.archived === "true").pipe(Effect.provide(core)),
      )
      .handle("readAll", () =>
        notificationCommands.markAllNotificationsRead.execute({}).pipe(Effect.provide(core)),
      )
      .handle("read", ({ params }) =>
        notificationCommands.markNotificationRead
          .execute({ notificationId: params.notificationId })
          .pipe(Effect.provide(core)),
      )
      .handle("unread", ({ params }) =>
        notificationCommands.markNotificationUnread
          .execute({ notificationId: params.notificationId })
          .pipe(Effect.provide(core)),
      )
      .handle("archive", ({ params }) =>
        notificationCommands.archiveNotification
          .execute({ notificationId: params.notificationId })
          .pipe(Effect.provide(core)),
      )
      .handle("unarchive", ({ params }) =>
        notificationCommands.unarchiveNotification
          .execute({ notificationId: params.notificationId })
          .pipe(Effect.provide(core)),
      )
      .handle("settings", () =>
        notificationQueries.notificationSettings().pipe(Effect.provide(core)),
      )
      .handle("updatePref", ({ payload }) =>
        notificationCommands.updateNotificationPref.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("updateQuietHours", ({ payload }) =>
        notificationCommands.updateQuietHours.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("subscribePush", ({ payload }) =>
        notificationCommands.subscribePush.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("unsubscribePush", ({ payload }) =>
        notificationCommands.unsubscribePush.execute(payload).pipe(Effect.provide(core)),
      )
  }),
)

const ChatLive = HttpApiBuilder.group(AuditApi, "chat", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("channels", () =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.sidebar(me)),
          Effect.provide(core),
        ),
      )
      .handle("browse", () =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.browse(me)),
          Effect.provide(core),
        ),
      )
      .handle("createChannel", ({ payload }) =>
        chatCommands.createChannel.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("channel", ({ params }) =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.channelHeader(params.channelId, me)),
          Effect.provide(core),
        ),
      )
      .handle("updateChannel", ({ params, payload }) =>
        chatCommands.updateChannel
          .execute({ channelId: params.channelId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("archiveChannel", ({ params }) =>
        chatCommands.archiveChannel
          .execute({ channelId: params.channelId })
          .pipe(Effect.provide(core)),
      )
      .handle("unarchiveChannel", ({ params }) =>
        chatCommands.unarchiveChannel
          .execute({ channelId: params.channelId })
          .pipe(Effect.provide(core)),
      )
      .handle("joinChannel", ({ params }) =>
        chatCommands.joinChannel
          .execute({ channelId: params.channelId })
          .pipe(Effect.provide(core)),
      )
      .handle("leaveChannel", ({ params }) =>
        chatCommands.leaveChannel
          .execute({ channelId: params.channelId })
          .pipe(Effect.provide(core)),
      )
      .handle("addMembers", ({ params, payload }) =>
        chatCommands.addMembers.execute({ channelId: params.channelId, ...payload }).pipe(
          Effect.provide(core),
          Effect.flatMap(({ channelId }) =>
            currentUser("chat.read").pipe(
              Effect.flatMap((me) => chatQueries.channelHeader(channelId, me)),
              Effect.provide(core),
            ),
          ),
        ),
      )
      .handle("removeMember", ({ params, payload }) =>
        chatCommands.removeMember.execute({ channelId: params.channelId, ...payload }).pipe(
          Effect.provide(core),
          Effect.flatMap(({ channelId }) =>
            currentUser("chat.read").pipe(
              Effect.flatMap((me) => chatQueries.channelHeader(channelId, me)),
              Effect.provide(core),
            ),
          ),
        ),
      )
      .handle("setNotify", ({ params, payload }) =>
        chatCommands.setNotify
          .execute({ channelId: params.channelId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("markRead", ({ params, payload }) =>
        chatCommands.markRead
          .execute({ channelId: params.channelId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("openDm", ({ payload }) =>
        chatCommands.openDm.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("messages", ({ params, query }) =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.messagePage(params.channelId, query, me)),
          Effect.provide(core),
        ),
      )
      .handle("postMessage", ({ params, payload }) =>
        chatCommands.postMessage
          .execute({ channelId: params.channelId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("editMessage", ({ params, payload }) =>
        chatCommands.editMessage
          .execute({ messageId: params.messageId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteMessage", ({ params }) =>
        chatCommands.deleteMessage
          .execute({ messageId: params.messageId })
          .pipe(Effect.provide(core)),
      )
      .handle("addReaction", ({ params, payload }) =>
        chatCommands.addReaction
          .execute({ messageId: params.messageId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("removeReaction", ({ params, payload }) =>
        chatCommands.removeReaction
          .execute({ messageId: params.messageId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("pins", ({ params }) =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.pinnedMessages(params.channelId, me)),
          Effect.provide(core),
        ),
      )
      .handle("pin", ({ params }) =>
        chatCommands.pinMessage.execute({ messageId: params.messageId }).pipe(Effect.provide(core)),
      )
      .handle("unpin", ({ params }) =>
        chatCommands.unpinMessage
          .execute({ messageId: params.messageId })
          .pipe(Effect.provide(core)),
      )
      .handle("save", ({ params }) =>
        chatCommands.saveMessage
          .execute({ messageId: params.messageId })
          .pipe(Effect.provide(core)),
      )
      .handle("unsave", ({ params }) =>
        chatCommands.unsaveMessage
          .execute({ messageId: params.messageId })
          .pipe(Effect.provide(core)),
      )
      .handle("messageToTask", ({ params, payload }) =>
        chatCommands.messageToTask
          .execute({ messageId: params.messageId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("saved", () =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.saved(me)),
          Effect.provide(core),
        ),
      )
      .handle("thread", ({ params, query }) =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) =>
            chatQueries
              .threadRootOf(params.messageId)
              .pipe(Effect.flatMap((root) => chatQueries.threadView(root, query, me))),
          ),
          Effect.provide(core),
        ),
      )
      .handle("threads", () =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.threads(me)),
          Effect.provide(core),
        ),
      )
      .handle("followThread", ({ params }) =>
        chatCommands.followThread
          .execute({ messageId: params.messageId })
          .pipe(Effect.provide(core)),
      )
      .handle("unfollowThread", ({ params }) =>
        chatCommands.unfollowThread
          .execute({ messageId: params.messageId })
          .pipe(Effect.provide(core)),
      )
      .handle("threadMarkRead", ({ params }) =>
        chatCommands.threadMarkRead
          .execute({ messageId: params.messageId })
          .pipe(Effect.provide(core)),
      )
      .handle("threadToDoc", ({ params, payload }) =>
        chatThreadDoc.threadToDoc
          .execute({ messageId: params.messageId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("adminChannel", ({ params }) =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.adminChannel(params.channelId, me)),
          Effect.provide(core),
        ),
      )
      .handle("adminMessages", ({ params, query }) =>
        currentUser("chat.read").pipe(
          Effect.flatMap((me) => chatQueries.adminMessages(params.channelId, query, me)),
          Effect.provide(core),
        ),
      )
  }),
)

const DocsLive = HttpApiBuilder.group(AuditApi, "docs", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("projectTree", ({ params }) =>
        docQueries.projectTree(params.projectId).pipe(Effect.provide(core)),
      )
      .handle("spaceTree", () => docQueries.spaceTree().pipe(Effect.provide(core)))
      .handle("get", ({ params }) => docQueries.getDoc(params.docId).pipe(Effect.provide(core)))
      .handle("create", ({ payload }) =>
        docCommands.createDoc.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("import", ({ payload }) =>
        docCommands.importDoc.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("rename", ({ params, payload }) =>
        docCommands.renameDoc
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("setIcon", ({ params, payload }) =>
        docCommands.setDocIcon
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("move", ({ params, payload }) =>
        docCommands.moveDoc.execute({ docId: params.docId, ...payload }).pipe(Effect.provide(core)),
      )
      .handle("delete", ({ params, payload }) =>
        docCommands.deleteDoc
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("setRestricted", ({ params, payload }) =>
        docCommands.setDocRestricted
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("setReview", ({ params, payload }) =>
        docCommands.setDocReview
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("verify", ({ params }) =>
        docCommands.verifyDoc.execute({ docId: params.docId }).pipe(Effect.provide(core)),
      )
      .handle("grant", ({ params, payload }) =>
        docCommands.grantDocAccess
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.asVoid, Effect.provide(core)),
      )
      .handle("revoke", ({ params, payload }) =>
        docCommands.revokeDocAccess
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.asVoid, Effect.provide(core)),
      )
      .handle("versions", ({ params }) =>
        docQueries.listVersions(params.docId).pipe(Effect.provide(core)),
      )
      .handle("createVersion", ({ params, payload }) =>
        docCommands.createDocVersion
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("version", ({ params }) =>
        docQueries.getVersion(params.docId, params.versionId).pipe(Effect.provide(core)),
      )
      .handle("restoreVersion", ({ params }) =>
        docCommands.restoreDocVersion
          .execute({ docId: params.docId, versionId: params.versionId })
          .pipe(Effect.provide(core)),
      )
      .handle("comments", ({ params }) =>
        docComments.listDocComments(params.docId).pipe(Effect.provide(core)),
      )
      .handle("createComment", ({ params, payload }) =>
        docComments.createDocComment
          .execute({ docId: params.docId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("updateComment", ({ params, payload }) =>
        docComments.updateDocComment
          .execute({ commentId: params.commentId, ...payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteComment", ({ params }) =>
        docComments.deleteDocComment
          .execute({ commentId: params.commentId })
          .pipe(Effect.provide(core)),
      )
      .handle("exportMarkdown", ({ params }) =>
        docQueries.exportDoc(params.docId, "md").pipe(
          Effect.map((exported) => exported.body),
          Effect.provide(core),
        ),
      )
      .handle("exportHtml", ({ params }) =>
        docQueries.exportDoc(params.docId, "html").pipe(
          Effect.map((exported) => exported.body),
          Effect.provide(core),
        ),
      )
  }),
)

const EntitiesLive = HttpApiBuilder.group(AuditApi, "entities", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("resolve", ({ payload }) => resolveEntities(payload.ids).pipe(Effect.provide(core)))
      .handle("backlinks", ({ params }) => backlinks(params.entityId).pipe(Effect.provide(core)))
  }),
)

const PeopleLive = HttpApiBuilder.group(AuditApi, "people", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("transferOwnership", ({ params }) =>
        peopleCommands.transferOwnership
          .execute({ userId: params.userId })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteMember", ({ params }) =>
        peopleCommands.deleteMember.execute(params.userId).pipe(Effect.provide(core)),
      )
      .handle("exportMine", () =>
        peopleCommands.exportMine.execute(undefined).pipe(
          Effect.catchTag("NotFound", (e) => Effect.die(e)),
          Effect.provide(core),
        ),
      )
  }),
)

const serverVersion = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(pkg)

const AdminLive = HttpApiBuilder.group(AuditApi, "admin", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("overview", () =>
        adminQueries.overview.pipe(
          Effect.map((overview) => ({
            ...overview,
            version: serverVersion.version,
            gitSha: process.env.GIT_SHA ?? null,
          })),
          Effect.provide(core),
        ),
      )
      .handle("accessItem", ({ params }) =>
        adminQueries.accessItem(params.entityId).pipe(Effect.provide(core)),
      )
      .handle("accessPerson", ({ params }) =>
        adminQueries.accessPerson(params.userId).pipe(Effect.provide(core)),
      )
      .handle("updateSecurity", ({ payload }) =>
        adminCommands.updateSecurity.execute(payload).pipe(Effect.asVoid, Effect.provide(core)),
      )
      .handle("updateBranding", ({ payload }) =>
        adminCommands.updateBranding.execute(payload).pipe(Effect.asVoid, Effect.provide(core)),
      )
      .handle("updateRetention", ({ payload }) =>
        adminCommands.updateRetention.execute(payload).pipe(Effect.asVoid, Effect.provide(core)),
      )
      .handle("emailStatus", () => adminQueries.emailStatus.pipe(Effect.provide(core)))
      .handle("runOrphanCleanup", () =>
        adminCommands.runOrphanCleanup.execute({}).pipe(Effect.provide(core)),
      )
      .handle("maintenance", () => maintenance.maintenanceStatus.pipe(Effect.provide(core)))
      .handle("rebalanceBoards", () =>
        maintenance.requestRebalanceBoards.execute({}).pipe(Effect.provide(core)),
      )
      .handle("compactDocs", () =>
        maintenance.requestDocCompaction.execute({}).pipe(Effect.provide(core)),
      )
      .handle("reembed", () => maintenance.requestReembed.execute({}).pipe(Effect.provide(core)))
      .handle("emailTest", ({ payload }) =>
        adminCommands.sendEmailTest.execute(payload).pipe(Effect.asVoid, Effect.provide(core)),
      )
      .handle("storage", () => adminQueries.storage.pipe(Effect.provide(core)))
  }),
)

const AiAdminLive = HttpApiBuilder.group(AuditApi, "aiAdmin", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("settings", () => aiQueries.aiSettings.pipe(Effect.provide(core)))
      .handle("updateSettings", ({ payload }) =>
        aiCommands.updateSettings.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("providers", () => aiQueries.providerList.pipe(Effect.provide(core)))
      .handle("createProvider", ({ payload }) =>
        aiCommands.createProvider.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("updateProvider", ({ params, payload }) =>
        aiCommands.updateProvider
          .execute({ providerId: params.providerId, patch: payload })
          .pipe(Effect.provide(core)),
      )
      .handle("deleteProvider", ({ params }) =>
        aiCommands.deleteProvider
          .execute({ providerId: params.providerId })
          .pipe(Effect.provide(core)),
      )
      .handle("testProvider", ({ params }) =>
        aiCommands.testProvider
          .execute({ providerId: params.providerId })
          .pipe(Effect.provide(core)),
      )
      .handle("usage", ({ query }) => aiQueries.aiUsage(query.month).pipe(Effect.provide(core)))
  }),
)

const AiLive = HttpApiBuilder.group(AuditApi, "ai", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("status", () => aiConversations.aiStatus.pipe(Effect.provide(core)))
      .handle("conversations", () => aiConversations.listConversations.pipe(Effect.provide(core)))
      .handle("createConversation", ({ payload }) =>
        aiConversations.createConversation.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("conversation", ({ params }) =>
        aiConversations.conversationDetail(params.conversationId).pipe(Effect.provide(core)),
      )
      .handle("deleteConversation", ({ params }) =>
        aiConversations.deleteConversation
          .execute({ conversationId: params.conversationId })
          .pipe(Effect.provide(core)),
      )
      .handle("chat", ({ params, payload }) =>
        aiConversations
          .sendChat({ conversationId: params.conversationId, text: payload.text })
          .pipe(Effect.provide(core)),
      )
      .handle("proposals", () => aiProposals.listProposals(null).pipe(Effect.provide(core)))
      .handle("approveProposal", ({ params }) =>
        aiProposals.approveProposal
          .execute({ proposalId: params.proposalId })
          .pipe(Effect.provide(core)),
      )
      .handle("rejectProposal", ({ params }) =>
        aiProposals.rejectProposal
          .execute({ proposalId: params.proposalId })
          .pipe(Effect.provide(core)),
      )
      .handle("preferences", () => aiConversations.aiPreferences.pipe(Effect.provide(core)))
      .handle("updatePreferences", ({ payload }) =>
        aiConversations.updatePreferences.execute(payload).pipe(Effect.provide(core)),
      )
      .handle("action", ({ payload }) => runAiAction(payload).pipe(Effect.provide(core)))
  }),
)

const SignupLive = HttpApiBuilder.group(AuditApi, "signup", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    const limiter = yield* RateLimiter
    return handlers.handle("signup", ({ payload }) =>
      Effect.gen(function* () {
        const meta = yield* clientMeta
        yield* limiter.check("signup", meta.ip ?? "unknown")
        return yield* adminSignup.signup
          .execute(payload)
          .pipe(
            systemActor("signup"),
            Effect.provideService(RequestMeta, meta),
            Effect.provide(core),
          )
      }),
    )
  }),
)

const SearchLive = HttpApiBuilder.group(AuditApi, "search", (handlers) =>
  Effect.gen(function* () {
    const core = yield* coreContext
    return handlers
      .handle("search", ({ query }) =>
        searchQueries.search.execute(query).pipe(Effect.provide(core)),
      )
      .handle("quick", ({ query }) => searchQueries.quick.execute(query).pipe(Effect.provide(core)))
      .handle("reindex", () => requestReindex.execute({}).pipe(Effect.provide(core)))
      .handle("reindexStatus", () => reindexStatus.pipe(Effect.provide(core)))
      .handle("recordRecent", ({ payload }) =>
        recordRecent.execute(payload).pipe(Effect.provide(core)),
      )
  }),
)

export const HttpApiLive = HttpApiBuilder.layer(AuditApi, {
  openapiPath: "/api/openapi.json",
}).pipe(
  Layer.provide([
    SetupLive,
    CalendarLive,
    JoinLive,
    MeLive,
    WorkspaceLive,
    MembersLive,
    InvitesLive,
    TeamsLive,
    TrailLive,
    ProjectsLive,
    BoardsLive,
    TasksLive,
    ChatLive,
    NotificationsLive,
    DocsLive,
    EntitiesLive,
    PeopleLive,
    AdminLive,
    AiAdminLive,
    AiLive,
    SignupLive,
    SearchLive,
  ]),
  Layer.provide(AuthenticationLive),
)
