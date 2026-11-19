/**
 * Keeps embeddings close to content. Domain events that change indexed text enqueue one sync per
 * entity. The job is debounced: pg-boss delays it by a minute and drops duplicates within that
 * window, so a burst of edits becomes one sync that reads the latest content when it runs.
 */
import type { DomainEvent } from "@audit/domain/events"
import { Db } from "@audit/platform/database"
import { Jobs } from "@audit/platform/jobs"
import { sql } from "drizzle-orm"
import { Effect, Stream } from "effect"
import { EventBus } from "../event-bus.ts"
import { embeddingSyncJob } from "./sync.ts"

/** Quiet period before a changed entity is re-indexed. */
export const DEBOUNCE_SECONDS = 60

/** Entities whose indexed text this event may change. */
const changedEntities = (event: DomainEvent): ReadonlyArray<string | null> => {
  switch (event._tag) {
    case "TaskChanged":
      return [event.entityId]
    case "DocChanged":
      return [event.docId]
    case "CommentChanged":
      return [event.taskId]
    case "MessageChanged":
      return [event.entityId]
    case "EventChanged":
      return [event.entityId]
    default:
      return []
  }
}

/**
 * The entity whose chunks cover a changed entity. A message reply is indexed inside its thread
 * root, so the root is what gets synced.
 */
const indexTarget = (entityId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .execute<{ id: string }>(
        sql`select coalesce(thread_root_id, id) as id from messages where id = ${entityId}`,
      )
      .pipe(
        Effect.map((result) => result.rows),
        Effect.orDie,
      )
    return row?.id ?? entityId
  })

/** Enqueues the debounced sync for every entity the event touched. */
export const scheduleEmbeddingSync = (event: DomainEvent) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs
    for (const entityId of changedEntities(event)) {
      if (entityId === null) continue
      const target = event._tag === "MessageChanged" ? yield* indexTarget(entityId) : entityId
      yield* jobs.enqueue(
        embeddingSyncJob,
        { entityId: target },
        {
          singletonKey: `embed:${target}`,
          singletonSeconds: DEBOUNCE_SECONDS,
          startAfter: DEBOUNCE_SECONDS,
        },
      )
    }
  })

/** Forks the subscriber that turns domain events into sync jobs. Lives as long as the scope. */
export const startEmbeddingIndexer = Effect.gen(function* () {
  const bus = yield* EventBus
  const events = yield* bus.subscribe
  yield* events.pipe(
    Stream.runForEach((event) =>
      scheduleEmbeddingSync(event).pipe(
        Effect.catchCause((cause) => Effect.logWarning("embedding index scheduling failed", cause)),
      ),
    ),
    Effect.forkScoped,
  )
})
