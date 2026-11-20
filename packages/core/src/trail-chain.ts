/**
 * Chains committed trail entries. Commands only insert their entries; the hash chain is extended
 * after their transactions commit. `trail_chain()` takes its own advisory lock, so only one chainer
 * runs at a time and chain order is the order the chainer saw the commits.
 */
import { Db } from "@audit/platform/database"
import { sql } from "drizzle-orm"
import { Effect, Queue, Stream } from "effect"
import { EventBus } from "./event-bus.ts"
import { loadTrailKey } from "./trail-key.ts"

const BATCH = 500

/** Chains every pending entry and returns how many were chained. */
export const chainTrail = Effect.gen(function* () {
  const db = yield* Db
  const pending = yield* db
    .execute<{ pending: boolean }>(
      sql`select exists (select 1 from trail_events where chain_pos is null) as pending`,
    )
    .pipe(Effect.orDie)
  if (pending.rows[0]?.pending !== true) return 0
  const key = yield* loadTrailKey
  let total = 0
  let chained = BATCH
  while (chained === BATCH) {
    const result = yield* db
      .execute<{ chained: number }>(sql`select trail_chain(${key}, ${BATCH}) as chained`)
      .pipe(Effect.orDie)
    chained = Number(result.rows[0]?.chained ?? 0)
    total += chained
  }
  return total
})

/**
 * Keeps the chain current. Wakes when commands publish their events after commit, and sweeps at
 * least once a second for commands that publish none. Not woken by Postgres NOTIFY: a NOTIFY takes a
 * database-wide lock at commit, which would serialise every command again.
 * Needs a Scope for the event subscription.
 */
export const trailChainer = Effect.gen(function* () {
  const bus = yield* EventBus
  const events = yield* bus.subscribe
  // One pending wakeup is enough: a pass chains everything committed so far.
  const wakeups = yield* Queue.sliding<void>(1)
  yield* events.pipe(
    Stream.runForEach(() => Queue.offer(wakeups, undefined)),
    Effect.forkScoped,
  )
  const pass = chainTrail.pipe(
    Effect.catchCause((cause) =>
      Effect.logError("trail chaining failed; retrying", cause).pipe(
        Effect.andThen(Effect.sleep("5 seconds")),
      ),
    ),
  )
  const wait = Effect.raceFirst(Queue.take(wakeups), Effect.sleep("1 second")).pipe(
    Effect.ignore,
    // Let a burst of commits land so one pass chains them together.
    Effect.andThen(Effect.sleep("100 millis")),
  )
  return yield* Effect.forever(pass.pipe(Effect.andThen(wait)))
})
