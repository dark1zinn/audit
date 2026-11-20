import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type SQL, sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { entityTypes } from "@audit/db/schema/core"
import { containerTypes, roleOnEntity, visibleTo } from "@audit/core/access"
import type { EntityId, UserId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, setupWorkspace } from "@audit/testkit/fixtures"

/*
 * Oracle: the materialised `entities.access_path` must give the same answers as the recursive
 * walks it replaced. Random edits (insert, move, restrict, retype, soft delete, grant, revoke,
 * deactivate) run against a live database; every few steps each user × entity pair is compared
 * with the recursive reference below, and every stored path with a from-scratch recomputation.
 */

const dialect = new PgDialect()
let database: TestDatabase
let people: Person[]

const render = (query: SQL) => {
  const { sql: text, params } = dialect.sqlToQuery(query)
  return database.superuser.unsafe<Record<string, unknown>[]>(text, params as string[])
}

const containers = sql.raw(containerTypes.map((t) => `'${t}'`).join(", "))
const directory = sql.raw(`'user', 'team'`)

/** Test ids come from the database, so branding them for the access helpers is safe. */
const asUser = (id: string) => id as UserId
const asEntity = (id: string) => id as EntityId

const entryMatch = (userId: string) => sql`(
  (ae.principal_type = 'user' and ae.principal_id = ${userId})
  or (ae.principal_type = 'team' and exists (
    select 1 from team_members tm where tm.team_id = ae.principal_id and tm.user_id = ${userId}))
  or (ae.principal_type = 'role' and ae.principal_role = (
    select wm.role from workspace_members wm where wm.user_id = ${userId})))`

const active = (userId: string) => sql`exists (
  select 1 from user_profiles act_p where act_p.user_id = ${userId} and act_p.deactivated_at is null)`

const chainStep = sql`select p.id, p.parent_id, p.restricted, p.type from chain c
  join entities p on p.id = c.parent_id
  where not c.restricted and c.type not in (${containers})`

/** Recursive reference: the original `visibleTo`, kept only as the oracle. */
const oldVisible = (userId: string, entityId: string) => sql`(${active(userId)} and exists (
  with recursive chain(id, parent_id, restricted, type) as (
    select e.id, e.parent_id, e.restricted, e.type from entities e
    where e.id = ${entityId} and e.deleted_at is null
    union all ${chainStep}
  )
  select 1 from chain c where c.type in (${directory})
    or (c.type in (${containers}) and exists (
      select 1 from container_access ca where ca.container_id = c.id and ca.user_id = ${userId}))
    or (c.type not in (${containers}) and exists (
      select 1 from access_entries ae where ae.resource_id = c.id and ${entryMatch(userId)}))
))`

/** Recursive reference: the original `roleOnEntity`. */
const oldRole = (userId: string, entityId: string) => sql`
  with recursive chain(id, parent_id, restricted, type) as (
    select e.id, e.parent_id, e.restricted, e.type from entities e where e.id = ${entityId}
    union all ${chainStep}
  ),
  roles as (
    select 'viewer' as role from chain c where c.type in (${directory})
    union all
    select ca.role from chain c join container_access ca
      on ca.container_id = c.id and ca.user_id = ${userId}
    where c.type in (${containers})
    union all
    select ae.role from chain c join access_entries ae on ae.resource_id = c.id
    where c.type not in (${containers}) and ${entryMatch(userId)}
  )
  select role from roles where ${active(userId)}
  order by case role when 'manager' then 4 when 'editor' then 3 when 'commenter' then 2
    when 'viewer' then 1 else 0 end desc limit 1`

/** Deterministic PRNG so a failure reproduces. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const roles = ["viewer", "commenter", "editor", "manager"] as const

interface Row {
  id: string
  parent_id: string | null
  restricted: boolean
  type: string
}

/** Independent from-scratch path computation for the stored-path check. */
const expectedPaths = (rows: Row[]) => {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const memo = new Map<string, string[]>()
  const pathOf = (row: Row): string[] => {
    const known = memo.get(row.id)
    if (known) return known
    const parent = row.parent_id === null ? undefined : byId.get(row.parent_id)
    const stop =
      row.restricted || (containerTypes as readonly string[]).includes(row.type) || !parent
    const path = stop || parent === undefined ? [row.id] : [row.id, ...pathOf(parent)]
    memo.set(row.id, path)
    return path
  }
  return new Map(rows.map((row) => [row.id, pathOf(row).join(",")]))
}

const allRows = () =>
  database.superuser.unsafe<Row[]>(`select id, parent_id, restricted, type from entities`)

const checkStoredPaths = async (label: string) => {
  const rows = await allRows()
  const stored = await database.superuser.unsafe<{ id: string; access_path: string[] }[]>(
    `select id, access_path from entities`,
  )
  const expected = expectedPaths(rows)
  for (const row of stored) {
    const path = row.access_path.join(",")
    expect({ label, id: row.id, path }).toEqual({
      label,
      id: row.id,
      path: expected.get(row.id) ?? "<no expected path>",
    })
  }
}

beforeAll(async () => {
  database = await makeTestDatabase()
  const owner = await setupWorkspace(database)
  const member = await addPerson(database, owner, "Mia", "member")
  const guest = await addPerson(database, owner, "Gus", "guest")
  people = [owner, member, guest]
})

afterAll(() => database.drop())

describe("entities.access_path", () => {
  test("matches the recursive reference and stored paths after random edits", async () => {
    const next = rng(20261120)
    const pick = <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)]
      if (item === undefined) throw new Error("pick from an empty list")
      return item
    }
    const userIds = people.map((person) => person.userId as string)

    const ids: string[] = []
    const insert = async () => {
      const type = pick(entityTypes)
      const parent = ids.length > 0 && next() < 0.8 ? pick(ids) : null
      const rows = await database.superuser.unsafe<{ id: string }[]>(
        `insert into entities (type, parent_id, restricted, title)
         values ($1, $2, $3, $4) returning id`,
        [type, parent, next() < 0.25, `e${ids.length}`],
      )
      const row = rows[0]
      if (row === undefined) throw new Error("insert returned no row")
      ids.push(row.id)
    }
    for (let i = 0; i < 25; i++) await insert()

    const subtree = async (rootId: string) => {
      const rows = await database.superuser.unsafe<{ id: string }[]>(
        `with recursive t(id) as (select $1::uuid union all
           select e.id from entities e join t on e.parent_id = t.id)
         select id from t`,
        [rootId],
      )
      return new Set(rows.map((row) => row.id))
    }

    const comparePairs = async (step: number) => {
      for (const userId of userIds) {
        for (const entityId of ids) {
          const [oldV] = await render(sql`select (${oldVisible(userId, entityId)}) as v`)
          const [newV] = await render(
            sql`select (${visibleTo(sql`${userId}`, sql`${entityId}::uuid`)}) as v`,
          )
          expect({ step, userId, entityId, visible: newV?.v }).toEqual({
            step,
            userId,
            entityId,
            visible: oldV?.v,
          })
          const oldR = await render(oldRole(userId, entityId))
          const newR = await render(sql`${roleOnEntity(asUser(userId), asEntity(entityId))}`)
          expect({ step, userId, entityId, role: newR[0]?.role ?? null }).toEqual({
            step,
            userId,
            entityId,
            role: oldR[0]?.role ?? null,
          })
        }
      }
    }

    for (let step = 0; step < 120; step++) {
      const op = next()
      const target = pick(ids)
      if (op < 0.12) await insert()
      else if (op < 0.3) {
        const blocked = await subtree(target)
        const candidates = ids.filter((id) => !blocked.has(id))
        const parent = next() < 0.15 || candidates.length === 0 ? null : pick(candidates)
        await database.superuser.unsafe(`update entities set parent_id = $2 where id = $1`, [
          target,
          parent,
        ])
      } else if (op < 0.4) {
        await database.superuser.unsafe(
          `update entities set restricted = not restricted where id = $1`,
          [target],
        )
      } else if (op < 0.5) {
        await database.superuser.unsafe(`update entities set type = $2 where id = $1`, [
          target,
          pick(entityTypes),
        ])
      } else if (op < 0.56) {
        await database.superuser.unsafe(
          `update entities set deleted_at = case when deleted_at is null then now() end
           where id = $1`,
          [target],
        )
      } else if (op < 0.7) {
        await database.superuser.unsafe(
          `insert into container_access (user_id, container_id, role) values ($1, $2, $3)
           on conflict (user_id, container_id) do update set role = excluded.role`,
          [pick(userIds), target, pick(roles)],
        )
      } else if (op < 0.78) {
        await database.superuser.unsafe(
          `delete from container_access where user_id = $1 and container_id = $2`,
          [pick(userIds), target],
        )
      } else if (op < 0.9) {
        await database.superuser.unsafe(
          `insert into access_entries (resource_id, principal_type, principal_id, role)
           values ($1, 'user', $2, $3)
           on conflict do nothing`,
          [target, pick(userIds), pick(roles)],
        )
      } else if (op < 0.94) {
        await database.superuser.unsafe(
          `delete from access_entries where resource_id = $1 and principal_id = $2`,
          [target, pick(userIds)],
        )
      } else {
        await database.superuser.unsafe(
          `update user_profiles set deactivated_at = case when deactivated_at is null then now() end
           where user_id = $1`,
          [pick(userIds)],
        )
      }
      if (step % 10 === 9 || step === 119) {
        await checkStoredPaths(`step ${step}`)
        await comparePairs(step)
      }
    }
  }, 600_000)

  test("a rebuild from the roots reproduces the stored paths", async () => {
    await database.superuser.unsafe(`select entities_access_path_rebuild()`)
    await checkStoredPaths("rebuild")
  })
})
