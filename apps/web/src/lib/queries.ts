import { queryOptions } from "@tanstack/react-query"
import type { BoardId, ProjectId, TaskId, TeamId } from "@audit/domain/ids"
import type { ListTasksQuery, CalendarQuery } from "@audit/domain/tasks/schema"
import { callApi } from "./api.ts"
import { errorKind } from "./errors.ts"

/**
 * Query keys. Realtime events invalidate these by prefix (see `realtime.ts`): every project-scoped
 * key starts with its feature name so a single prefix covers all of it.
 */
export const keys = {
  setup: ["setup"] as const,
  session: ["session"] as const,
  workspace: ["workspace"] as const,
  members: ["members"] as const,
  invites: ["invites"] as const,
  teams: ["teams"] as const,
  team: (teamId: string) => ["teams", teamId, "members"] as const,
  mine: ["mine"] as const,
  invitePreview: (token: string) => ["join", token] as const,
  projects: ["projects"] as const,
  adminProjects: ["admin", "projects"] as const,
  project: (projectId: ProjectId) => ["project", projectId] as const,
  access: (projectId: ProjectId) => ["access", projectId] as const,
  boards: (projectId: ProjectId) => ["boards", projectId] as const,
  board: (boardId: BoardId) => ["board", boardId] as const,
  boardView: (boardId: BoardId, query: ListTasksQuery) =>
    ["board", boardId, "view", query] as const,
  labels: (projectId: ProjectId) => ["labels", projectId] as const,
  tasks: (projectId: ProjectId, query: ListTasksQuery) => ["tasks", projectId, query] as const,
  calendar: (projectId: ProjectId, query: CalendarQuery) => ["calendar", projectId, query] as const,
  task: (taskId: TaskId) => ["task", taskId] as const,
  savedFilters: (projectId: ProjectId) => ["saved-filters", projectId] as const,
  calendars: ["calendars"] as const,
  calendarEvents: (from: string, to: string) => ["calendar-events", from, to] as const,
  notifications: ["notifications"] as const,
  notificationList: (archived: boolean) => ["notifications", "list", archived] as const,
  notificationSettings: ["notifications", "settings"] as const,
  adminOverview: ["admin", "overview"] as const,
  adminEmail: ["admin", "email"] as const,
  adminStorage: ["admin", "storage"] as const,
  adminAccessItem: (entityId: string) => ["admin", "access", "items", entityId] as const,
  adminAccessPerson: (userId: string) => ["admin", "access", "people", userId] as const,
}

/** The signed-in user, or `null` when there is no session. Never throws on 401. */
export const sessionQuery = queryOptions({
  queryKey: keys.session,
  queryFn: () =>
    callApi((api) => api.me.get()).catch((error: unknown) => {
      if (errorKind(error) === "unauthorized") return null
      throw error
    }),
  retry: false,
  staleTime: 30_000,
})

export const setupStatusQuery = queryOptions({
  queryKey: keys.setup,
  queryFn: () => callApi((api) => api.setup.status()),
  retry: false,
})

export const workspaceQuery = queryOptions({
  queryKey: keys.workspace,
  queryFn: () => callApi((api) => api.workspace.get()),
})

export const membersQuery = queryOptions({
  queryKey: keys.members,
  queryFn: () => callApi((api) => api.members.list()),
})

/** Admin dashboard counts, storage and sign-up posture. Owners and admins only. */
export const adminOverviewQuery = queryOptions({
  queryKey: keys.adminOverview,
  queryFn: () => callApi((api) => api.admin.overview()),
})

export const adminEmailQuery = queryOptions({
  queryKey: keys.adminEmail,
  queryFn: () => callApi((api) => api.admin.emailStatus()),
})

export const adminStorageQuery = queryOptions({
  queryKey: keys.adminStorage,
  queryFn: () => callApi((api) => api.admin.storage()),
})

export const invitesQuery = queryOptions({
  queryKey: keys.invites,
  queryFn: () => callApi((api) => api.invites.list()),
})

export const teamsQuery = queryOptions({
  queryKey: keys.teams,
  queryFn: () => callApi((api) => api.teams.list()),
})

export const teamMembersQuery = (teamId: TeamId) =>
  queryOptions({
    queryKey: keys.team(teamId),
    queryFn: () => callApi((api) => api.teams.members({ params: { teamId } })),
  })

export const invitePreviewQuery = (token: string) =>
  queryOptions({
    queryKey: keys.invitePreview(token),
    queryFn: () => callApi((api) => api.join.preview({ params: { token } })),
    retry: false,
  })

// --- Projects ---------------------------------------------------------------

/** Projects visible to the caller, for the sidebar and project lookups. */
export const projectsQuery = queryOptions({
  queryKey: keys.projects,
  queryFn: () => callApi((api) => api.projects.list()),
  staleTime: 30_000,
})

/** Every project including archived and deleted ones; admins only. */
export const adminProjectsQuery = queryOptions({
  queryKey: keys.adminProjects,
  queryFn: () => callApi((api) => api.projects.adminList()),
})

export const projectQuery = (projectId: ProjectId) =>
  queryOptions({
    queryKey: keys.project(projectId),
    queryFn: () => callApi((api) => api.projects.get({ params: { projectId } })),
  })

export const projectAccessQuery = (projectId: ProjectId) =>
  queryOptions({
    queryKey: keys.access(projectId),
    queryFn: () => callApi((api) => api.projects.access({ params: { projectId } })),
  })

export const boardsQuery = (projectId: ProjectId) =>
  queryOptions({
    queryKey: keys.boards(projectId),
    queryFn: () => callApi((api) => api.boards.list({ params: { projectId } })),
  })

export const labelsQuery = (projectId: ProjectId) =>
  queryOptions({
    queryKey: keys.labels(projectId),
    queryFn: () => callApi((api) => api.boards.labels({ params: { projectId } })),
  })

export const savedFiltersQuery = (projectId: ProjectId) =>
  queryOptions({
    queryKey: keys.savedFilters(projectId),
    queryFn: () => callApi((api) => api.tasks.savedFilters({ params: { projectId } })),
  })

// --- Tasks ------------------------------------------------------------------

export const boardViewQuery = (boardId: BoardId, query: ListTasksQuery) =>
  queryOptions({
    queryKey: keys.boardView(boardId, query),
    queryFn: () => callApi((api) => api.tasks.board({ params: { boardId }, query })),
  })

export const taskListQuery = (projectId: ProjectId, query: ListTasksQuery) =>
  queryOptions({
    queryKey: keys.tasks(projectId, query),
    queryFn: () => callApi((api) => api.tasks.list({ params: { projectId }, query })),
  })

export const calendarQuery = (projectId: ProjectId, query: CalendarQuery) =>
  queryOptions({
    queryKey: keys.calendar(projectId, query),
    queryFn: () => callApi((api) => api.tasks.calendar({ params: { projectId }, query })),
  })

export const calendarsQuery = queryOptions({
  queryKey: keys.calendars,
  queryFn: () => callApi((api) => api.calendar.calendars()),
})

export const calendarEventsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: keys.calendarEvents(from, to),
    queryFn: () => callApi((api) => api.calendar.events({ query: { from, to } })),
  })

export const myTasksQuery = queryOptions({
  queryKey: keys.mine,
  queryFn: () => callApi((api) => api.tasks.mine()),
})

export const taskDetailQuery = (taskId: TaskId) =>
  queryOptions({
    queryKey: keys.task(taskId),
    queryFn: () => callApi((api) => api.tasks.get({ params: { taskId } })),
  })

/** Inbox entries: unarchived by default, or the archived list. Realtime invalidates the prefix. */
export const notificationsQuery = (archived: boolean) =>
  queryOptions({
    queryKey: keys.notificationList(archived),
    queryFn: () =>
      callApi((api) =>
        api.notifications.list({ query: { archived: archived ? "true" : "false" } }),
      ),
  })

export const notificationSettingsQuery = queryOptions({
  queryKey: keys.notificationSettings,
  queryFn: () => callApi((api) => api.notifications.settings()),
})
