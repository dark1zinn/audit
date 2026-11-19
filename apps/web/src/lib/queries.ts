import { queryOptions } from "@tanstack/react-query"
import type { TeamId } from "@audit/domain/ids"
import { callApi } from "./api.ts"
import { errorKind } from "./errors.ts"

/** Query keys. Realtime events invalidate these by prefix. */
export const keys = {
  setup: ["setup"] as const,
  session: ["session"] as const,
  workspace: ["workspace"] as const,
  members: ["members"] as const,
  invites: ["invites"] as const,
  teams: ["teams"] as const,
  team: (teamId: string) => ["teams", teamId, "members"] as const,
  trail: (filter: string) => ["trail", filter] as const,
  invitePreview: (token: string) => ["join", token] as const,
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
