/**
 * Admin maintenance: on-demand runs of the background jobs that also run daily, and their latest
 * status. Each request and each completion is a trail entry; status reads the latest of each.
 */
import { trailEvents } from "@audit/db/schema"
import {
  type MaintenanceJobStatus,
  MaintenanceQueued,
  type MaintenanceStatus,
} from "@audit/domain/admin/schema"
import { Db } from "@audit/platform/database"
import { Jobs } from "@audit/platform/jobs"
import { desc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { reembedJob } from "../ai/reembed.ts"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { docsCompactJob } from "../docs/compaction.ts"
import { boardsRebalanceJob } from "../projects/rebalance.ts"
import { record } from "../trail.ts"

const requireSettings = () =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("workspace.settings")
  })

export const requestRebalanceBoards = Command.make("maintenance.rebalance_boards", {
  input: Schema.Struct({}),
  output: MaintenanceQueued,
  authorize: requireSettings,
  run: () =>
    Effect.gen(function* () {
      const jobs = yield* Jobs
      yield* record({ action: "board.rebalance_requested" })
      yield* jobs.enqueue(boardsRebalanceJob, {}, { singletonKey: "boards.rebalance" })
      return { queued: true as const }
    }),
})

export const requestDocCompaction = Command.make("maintenance.compact_docs", {
  input: Schema.Struct({}),
  output: MaintenanceQueued,
  authorize: requireSettings,
  run: () =>
    Effect.gen(function* () {
      const jobs = yield* Jobs
      yield* record({ action: "docs.compaction_requested" })
      yield* jobs.enqueue(docsCompactJob, {}, { singletonKey: "docs.compact" })
      return { queued: true as const }
    }),
})

export const requestReembed = Command.make("maintenance.reembed", {
  input: Schema.Struct({}),
  output: MaintenanceQueued,
  authorize: requireSettings,
  run: () =>
    Effect.gen(function* () {
      const jobs = yield* Jobs
      yield* record({ action: "ai.reembed_requested" })
      yield* jobs.enqueue(reembedJob, {}, { singletonKey: "ai.reembed" })
      return { queued: true as const }
    }),
})

const latest = (action: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        seq: trailEvents.seq,
        at: trailEvents.at,
        count: sql<number | null>`(${trailEvents.meta}->'details'->>'count')::int`,
      })
      .from(trailEvents)
      .where(eq(trailEvents.action, action))
      .orderBy(desc(trailEvents.seq))
      .limit(1)
      .pipe(Effect.orDie)
    return row
  })

/** Queued until a completion recorded after the latest request exists. */
const jobStatus = (requestedAction: string, doneAction: string) =>
  Effect.gen(function* () {
    const requested = yield* latest(requestedAction)
    const done = yield* latest(doneAction)
    if (requested === undefined) {
      const idle: MaintenanceJobStatus = {
        state: "idle",
        requestedAt: null,
        completedAt: null,
        count: null,
      }
      return idle
    }
    if (done !== undefined && done.seq > requested.seq) {
      const finished: MaintenanceJobStatus = {
        state: "done",
        requestedAt: requested.at,
        completedAt: done.at,
        count: done.count,
      }
      return finished
    }
    const queued: MaintenanceJobStatus = {
      state: "queued",
      requestedAt: requested.at,
      completedAt: null,
      count: null,
    }
    return queued
  })

export const maintenanceStatus = Effect.gen(function* () {
  yield* requireSettings()
  const status: MaintenanceStatus = {
    rebalance: yield* jobStatus("board.rebalance_requested", "board.rebalanced_all"),
    compaction: yield* jobStatus("docs.compaction_requested", "docs.compacted"),
    reembed: yield* jobStatus("ai.reembed_requested", "ai.reembedded"),
  }
  return status
})
