/**
 * Effective-access SQL. A user's role on an item is the highest role granted to them, their teams
 * or their workspace role, on that item or its ancestors up to the nearest restricted boundary.
 *
 * Containers (projects, boards, channels, calendars) have their effective roles materialised in
 * `container_access`; items walk `entities.parent_id` up to their container, collecting their own
 * grants on the way, and stop early at a restricted item.
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

/** The user's role on one entity, or no row when they have none. */
export const roleOnEntity = (userId: UserId, entityId: EntityId) => sql`
  with recursive chain as (
    select e.id, e.parent_id, e.type, e.restricted from entities e where e.id = ${entityId}
    union all
    select p.id, p.parent_id, p.type, p.restricted
    from chain c join entities p on p.id = c.parent_id
    where not c.restricted and c.type not in (${containers})
  ),
  roles as (
    select 'viewer' as role from chain c where c.type in (${directoryTypes})
    union all
    select ca.role from chain c
    join container_access ca on ca.container_id = c.id and ca.user_id = ${userId}
    where c.type in (${containers})
    union all
    select ae.role from chain c
    join access_entries ae on ae.resource_id = c.id
    where c.type not in (${containers}) and ${entryMatchesUser(sql`${userId}`)}
  )
  select role from roles where ${activeUser(sql`${userId}`)}
  order by ${roleRank(sql`role`)} desc limit 1
`

/**
 * Condition true when `idColumn` names an entity the user can see. Inner aliases are prefixed
 * `vis_` so they never shadow the caller's aliases inside `idColumn`. Used by every list, search,
 * backlink, notification fan-out, realtime filter and AI retrieval query.
 */
export const visibleTo = (userId: UserId | SQL, idColumn: SQL) => sql`(${activeUser(sql`${userId}`)}
  and exists (
  with recursive vis_chain as (
    select vis_e.id, vis_e.parent_id, vis_e.type, vis_e.restricted, true as start
    from entities vis_e where vis_e.id = ${idColumn} and vis_e.deleted_at is null
    union all
    select vis_p.id, vis_p.parent_id, vis_p.type, vis_p.restricted, false
    from vis_chain vis_c join entities vis_p on vis_p.id = vis_c.parent_id
    where not vis_c.restricted and vis_c.type not in (${containers})
  )
  select 1 from vis_chain vis_c
  where (vis_c.start and vis_c.type in (${directoryTypes}))
    or (vis_c.type in (${containers}) and exists (
      select 1 from container_access vis_ca
      where vis_ca.container_id = vis_c.id and vis_ca.user_id = ${userId}))
    or (vis_c.type not in (${containers}) and exists (
      select 1 from access_entries ae
      where ae.resource_id = vis_c.id and ${entryMatchesUser(sql`${userId}`)}))
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
