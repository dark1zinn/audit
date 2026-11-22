/**
 * Effective-access SQL. A user's role on an item is the highest role granted to them, their teams
 * or their workspace role, on that item or its ancestors up to the nearest restricted boundary.
 *
 * Containers (projects, boards, channels, calendars) have their effective roles materialised in
 * `container_access`. Every entity carries `entities.access_path`, its chain up to that boundary,
 * kept current by triggers, so both checks are a key lookup plus an array overlap.
 *
 * Owners and admins manage all project content and every doc: `adminManaged` is evaluated at query
 * time, so it needs no materialised rows and takes effect as soon as a role changes.
 */
import { type SQL, sql } from "drizzle-orm"
import type { ContainerType } from "@audit/domain/entity"
import type { EntityId, UserId } from "@audit/domain/ids"

export const containerTypes: ReadonlyArray<ContainerType> = [
  "project",
  "board",
  "channel",
  "calendar",
  "space",
]
const containers = sql.raw(containerTypes.map((t) => `'${t}'`).join(", "))

/** Entity types every workspace member can see (the directory). */
const directoryTypes = sql.raw(`'user', 'team'`)

export const roleRank = (column: SQL) =>
  sql`case ${column} when 'manager' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end`

/** True when the access entry `ae` grants something to `userId` (directly, via a team or role). */
const entryMatchesUser = (userId: SQL) => sql`(
  (ae.principal_type = 'user' and ae.principal_id = ${userId})
  or (ae.principal_type = 'team' and exists (
    select 1 from team_members tm where tm.team_id = ae.principal_id and tm.user_id = ${userId}))
  or (ae.principal_type = 'role' and ae.principal_role = (
    select wm.role from workspace_members wm where wm.user_id = ${userId}))
)`

/** Deactivated people hold no access at all, whatever their grants say. */
const activeUser = (userId: SQL) => sql`exists (
  select 1 from user_profiles act_p where act_p.user_id = ${userId} and act_p.deactivated_at is null
)`

/**
 * Node ids the user holds a grant on, as an array to overlap with `entities.access_path`. Container
 * grants come from `container_access`; item grants from `access_entries` on non-container
 * resources, so grants stored on a container never count as item grants.
 */
const grantedNodes = (userId: SQL) => sql`(
  select coalesce(array_agg(g.id), '{}') from (
    select ca.container_id as id from container_access ca
    join entities k on k.id = ca.container_id and k.type in (${containers})
    where ca.user_id = ${userId}
    union
    select ae.resource_id as id from access_entries ae
    join entities r on r.id = ae.resource_id
    where r.type not in (${containers}) and ${entryMatchesUser(userId)}
  ) g
)`

/**
 * True when the user is a workspace owner or admin and the entity under `alias` is project content
 * (a project, or anything carrying `project_id`) or a doc, restricted or not. DMs, non-project
 * channels and personal calendars carry no `project_id` and are not docs, so they stay private.
 */
const adminManaged = (userId: SQL, alias: string) => sql`(
  exists (select 1 from workspace_members adm_m
    where adm_m.user_id = ${userId} and adm_m.role in ('owner', 'admin'))
  and (${sql.raw(alias)}.type = 'project' or ${sql.raw(alias)}.project_id is not null
    or ${sql.raw(alias)}.type = 'doc')
)`

/** The user's role on one entity, or no row when they have none. */
export const roleOnEntity = (userId: UserId, entityId: EntityId) => sql`
  with chain as (
    select e.access_path as path from entities e where e.id = ${entityId}
  ),
  roles as (
    select 'viewer' as role from chain c
    where exists (select 1 from entities d where d.id = any(c.path) and d.type in (${directoryTypes}))
    union all
    select 'manager' from entities adm_e where adm_e.id = ${entityId} and ${adminManaged(sql`${userId}`, "adm_e")}
    union all
    select ca.role from chain c
    join container_access ca on ca.container_id = any(c.path) and ca.user_id = ${userId}
    join entities k on k.id = ca.container_id and k.type in (${containers})
    union all
    select ae.role from chain c
    join access_entries ae on ae.resource_id = any(c.path)
    join entities r on r.id = ae.resource_id
    where r.type not in (${containers}) and ${entryMatchesUser(sql`${userId}`)}
  )
  select role from roles where ${activeUser(sql`${userId}`)}
  order by ${roleRank(sql`role`)} desc limit 1
`

/**
 * Condition true when `idColumn` names an entity the user can see. Used by every list, search,
 * backlink, notification fan-out, realtime filter and AI retrieval query. The inner alias is
 * prefixed `vis_` so it never shadows the caller's aliases inside `idColumn`.
 */
export const visibleTo = (
  userId: UserId | SQL,
  idColumn: SQL,
  /** Same grants, but soft-deleted entities count: "could this user see it before deletion". */
  options: { readonly includeDeleted?: boolean } = {},
) => sql`(${activeUser(sql`${userId}`)}
  and exists (
    select 1 from entities vis_e
    where vis_e.id = ${idColumn} and ${options.includeDeleted === true ? sql`true` : sql`vis_e.deleted_at is null`}
      and (vis_e.access_path && ${grantedNodes(sql`${userId}`)}
        or ${adminManaged(sql`${userId}`, "vis_e")}
        or exists (
          select 1 from entities vis_d
          where vis_d.id = any(vis_e.access_path) and vis_d.type in (${directoryTypes})))
))`

/** Highest own grant on container `c` for member `m`. */
const ownGrant = sql`(
  select ae.role from access_entries ae
  where ae.resource_id = c.id and (
    (ae.principal_type = 'user' and ae.principal_id = m.user_id)
    or (ae.principal_type = 'team' and exists (
      select 1 from team_members tm where tm.team_id = ae.principal_id and tm.user_id = m.user_id))
    or (ae.principal_type = 'role' and ae.principal_role = m.role)
  )
  order by ${roleRank(sql`ae.role`)} desc limit 1
)`

export interface RebuildScope {
  readonly userId?: UserId
  /** Rebuild this container and the containers inside it. */
  readonly containerId?: EntityId
}

/**
 * Statements that rebuild `container_access` for the scope: top-level containers first, then the
 * containers inside projects, which inherit unless restricted.
 */
export const rebuildContainerAccess = (scope: RebuildScope): ReadonlyArray<SQL> => {
  const userFilter = scope.userId === undefined ? sql`true` : sql`m.user_id = ${scope.userId}`
  const containerFilter =
    scope.containerId === undefined
      ? sql`true`
      : sql`(c.id = ${scope.containerId} or c.parent_id = ${scope.containerId})`
  const deleteUser = scope.userId === undefined ? sql`true` : sql`ca.user_id = ${scope.userId}`
  const deleteContainer =
    scope.containerId === undefined
      ? sql`true`
      : sql`ca.container_id in (select c.id from entities c where ${containerFilter})`
  return [
    sql`delete from container_access ca where ${deleteUser} and ${deleteContainer}`,
    sql`
      insert into container_access (container_id, user_id, role)
      select c.id, m.user_id, g.role
      from entities c
      cross join workspace_members m
      cross join lateral (select ${ownGrant} as role) g
      where c.type in (${containers}) and c.deleted_at is null
        and (c.parent_id is null or c.type = 'project')
        and g.role is not null and ${userFilter} and ${containerFilter}
      on conflict (user_id, container_id) do update set role = excluded.role`,
    sql`
      insert into container_access (container_id, user_id, role)
      select c.id, m.user_id, g.role
      from entities c
      join entities parent on parent.id = c.parent_id
      cross join workspace_members m
      cross join lateral (
        select r.role from (
          select ${ownGrant} as role
          union all
          select pa.role from container_access pa
          where not c.restricted and pa.container_id = parent.id and pa.user_id = m.user_id
        ) r where r.role is not null
        order by ${roleRank(sql`r.role`)} desc limit 1
      ) g
      where c.type in (${containers}) and c.type <> 'project' and c.deleted_at is null
        and ${userFilter} and ${containerFilter}
      on conflict (user_id, container_id) do update set role = excluded.role`,
  ]
}
