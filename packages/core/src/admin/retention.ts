/**
 * Retention jobs.
 *
 * - Trail: entries older than `trailRetentionDays` are deleted. Only the retention role may delete
 *   trail rows (the append-only trigger enforces it), so the command switches role for that one
 *   statement and then records the purge as the normal role. Verification accepts a purged start
 *   only where `trail_anchor` records the cut, which `trail_purge` writes.
 * - Soft-deleted entities: an entity deleted more than `softDeleteRetentionDays` ago is removed
 *   with its type row and dependents (foreign keys cascade from `entities`). Its whole tree is
 *   removed only when every row under it is past the window, so a live or recent row keeps its
 *   ancestors. Blobs of purged files are deleted after the rows. Trail rows stay.
 */
import { CurrentActor } from "@audit/domain/actor"
import { Forbidden } from "@audit/domain/errors"
import { defaultWorkspaceSettings, type WorkspaceSettings } from "@audit/domain/identity/schema"
import { workspace } from "@audit/db/schema"
import { BlobStore } from "@audit/platform/blob-store"
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import * as Command from "../command.ts"
import { record, writeTrail } from "../trail.ts"

const DAY_MS = 24 * 60 * 60 * 1000

const requireSystem = (action: string) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor
    if (actor._tag !== "system") {
      return yield* new Forbidden({ action, message: "Only background jobs can do this" })
    }
  })

const loadSettings = Effect.gen(function* () {
  const db = yield* Db
  const [row] = yield* db
    .select({ settings: workspace.settings })
    .from(workspace)
    .pipe(Effect.orDie)
  const settings: WorkspaceSettings = {
    ...defaultWorkspaceSettings,
    ...(row?.settings as Partial<WorkspaceSettings> | undefined),
  }
  return settings
})

export const purgeTrail = Command.make("trail.retention", {
  input: Schema.Struct({}),
  output: Schema.Struct({ purged: Schema.Number }),
  authorize: () => requireSystem("trail.retention"),
  run: () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const settings = yield* loadSettings
      const cutoff = new Date(Date.now() - settings.trailRetentionDays * DAY_MS)

      const [row] = yield* sql<{ purged: string }>`
        select trail_purge(${settings.trailRetentionDays}) as purged
      `.pipe(Effect.orDie)
      const purged = Number(row?.purged ?? 0)
      if (purged > 0) {
        yield* record({
          action: "trail.purged",
          details: { count: purged, cutoff: cutoff.toISOString() },
        })
      }
      return { purged }
    }),
})

export const trailRetentionJob = defineJob("trail.retention", Schema.Struct({}))

const deleteBlob = (key: string) =>
  Effect.gen(function* () {
    const blobs = yield* BlobStore
    yield* blobs
      .delete(key)
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not delete a purged file's blob", { key, error }),
        ),
      )
  })

/** One output row: an entity removed (`label` is its type) or a blob to delete. */
type PurgeRow = {
  readonly kind: "entity" | "blob"
  readonly label: string | null
  readonly storage_key: string | null
  readonly thumbnail_key: string | null
}

/**
 * Purges entities soft-deleted past the retention window; runs as the system from the job.
 *
 * The `tree` CTE walks each expired entity's descendants along the links that cascade into it
 * (parent, project, comment target and replies, doc and message threads, recurrence, board). A
 * root is blocked when any row under it is live or still inside the window. The rest are deleted
 * in one statement; the cascades remove type rows and dependents in the same statement.
 */
export const purgeSoftDeleted = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const settings = yield* loadSettings
  const cutoff = new Date(Date.now() - (settings.softDeleteRetentionDays ?? 30) * DAY_MS)

  const rows = yield* sql<PurgeRow>`
    with recursive links(parent, child) as (
      select parent_id, id from entities where parent_id is not null
      union all select project_id, id from entities where project_id is not null
      union all select target_id, id from comments
      union all select parent_comment_id, id from comments where parent_comment_id is not null
      union all select parent_doc_id, id from docs where parent_doc_id is not null
      union all select thread_root_id, id from messages where thread_root_id is not null
      union all select recurrence_parent_id, id from events where recurrence_parent_id is not null
      union all select board_id, id from tasks
    ),
    tree(root, id) as (
      select id, id from entities where deleted_at < ${cutoff}
      union
      select tree.root, links.child from tree join links on links.parent = tree.id
    ),
    blocked as (
      select distinct tree.root from tree join entities on entities.id = tree.id
      where entities.deleted_at is null or entities.deleted_at >= ${cutoff}
    ),
    purged as (select distinct id from tree where root not in (select root from blocked)),
    blobs as (
      select files.storage_key, files.thumbnail_key
      from files join purged on purged.id = files.id
    ),
    gone as (
      delete from entities using purged where entities.id = purged.id returning entities.type
    )
    select 'entity' as kind, type as label, null::text as storage_key, null::text as thumbnail_key
    from gone
    union all
    select 'blob', null::text, storage_key, thumbnail_key from blobs
  `.pipe(Effect.orDie)

  const byType: Record<string, number> = {}
  const blobKeys: Array<string> = []
  for (const row of rows) {
    if (row.kind === "entity" && row.label !== null) {
      byType[row.label] = (byType[row.label] ?? 0) + 1
    } else {
      if (row.storage_key !== null) blobKeys.push(row.storage_key)
      if (row.thumbnail_key !== null) blobKeys.push(row.thumbnail_key)
    }
  }
  for (const key of blobKeys) yield* deleteBlob(key)

  const purged = Object.values(byType).reduce((total, count) => total + count, 0)
  if (purged > 0) {
    yield* writeTrail({
      action: "entities.purged",
      details: { count: purged, byType, cutoff: cutoff.toISOString() },
    })
  }
  return { purged }
})

export const softDeleteRetentionJob = defineJob("softdelete.retention", Schema.Struct({}))
