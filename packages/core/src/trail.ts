/**
 * The audit log (trail). Entries are written inside the command's transaction, so an entry exists
 * exactly when the change it describes committed.
 */
import { trailEvents } from "@audit/db/schema"
import { type Actor, CurrentActor } from "@audit/domain/actor"
import type { DomainEvent } from "@audit/domain/events"
import type { EntityId, ProjectId } from "@audit/domain/ids"
import type { TrailDiff } from "@audit/domain/trail/schema"
import { Db } from "@audit/platform/database"
import { Context, Effect } from "effect"
import { SqlClient } from "effect/sql"
import { RequestMeta } from "./request.ts"
import { loadTrailKey } from "./trail-key.ts"

export interface TrailEntry {
  readonly action: string
  readonly entityId?: EntityId | null
  readonly entityType?: string | null
  readonly projectId?: ProjectId | null
  readonly diff?: TrailDiff | null
  readonly details?: Record<string, unknown>
}

/** State of the command being run: its audit entries and the events to publish after commit. */
export class CommandScope extends Context.Service<
  CommandScope,
  {
    readonly name: string
    readonly events: Array<DomainEvent>
    trailEntries: number
  }
>()("@audit/core/CommandScope") {}

const actorColumns = (actor: Actor) => {
  switch (actor._tag) {
    case "user":
      return { actorType: "user" as const, actorId: actor.userId, onBehalfOf: null }
    case "ai":
      return { actorType: "ai" as const, actorId: null, onBehalfOf: actor.onBehalfOf }
    case "system":
      return { actorType: "system" as const, actorId: null, onBehalfOf: null }
  }
}

/** Writes one audit entry for the current actor and request. */
export const writeTrail = (entry: TrailEntry) =>
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient
    const actor = yield* CurrentActor
    const request = yield* RequestMeta
    const key = yield* loadTrailKey
    const meta = {
      ...request,
      ...(entry.details === undefined ? {} : { details: entry.details }),
      ...(actor._tag === "system" ? { system: actor.reason } : {}),
    }
    // The chain trigger reads the key from this transaction-local setting, so it must share the
    // insert's transaction.
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`select set_config('audit.trail_key', ${key}, true)`
        yield* db.insert(trailEvents).values({
          ...actorColumns(actor),
          action: entry.action,
          entityId: entry.entityId ?? null,
          entityType: entry.entityType ?? null,
          projectId: entry.projectId ?? null,
          diff: entry.diff ?? null,
          meta,
        })
      }),
    )
  }).pipe(Effect.orDie)

/** Records an audit entry for the running command. */
export const record = (entry: TrailEntry) =>
  Effect.gen(function* () {
    const scope = yield* CommandScope
    yield* writeTrail(entry)
    scope.trailEntries++
  })

/** Queues a domain event, published only if the command commits. */
export const emit = (event: DomainEvent) =>
  Effect.gen(function* () {
    const scope = yield* CommandScope
    scope.events.push(event)
  })

/** Field-level diff between two snapshots, limited to `fields`. */
export const diff = <T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: ReadonlyArray<keyof T & string>,
): TrailDiff => {
  const changes: Record<string, readonly [unknown, unknown]> = {}
  for (const field of fields) {
    if (!(field in after)) continue
    const a = before[field]
    const b = after[field]
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a ?? null, b ?? null]
  }
  return changes
}
