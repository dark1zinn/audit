import type { Authz } from "@audit/core/authz"
import type { EventBus } from "@audit/core/event-bus"
import { boardRebalance, rebalanceBoard } from "@audit/core/projects/rebalance"
import { dueSoonJob, overdueJob, remindDueSoon, remindOverdue } from "@audit/core/tasks/reminders"
import { CurrentActor } from "@audit/domain/actor"
import type { Db } from "@audit/platform/database"
import { Jobs, type JobDefinition } from "@audit/platform/jobs"
import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/sql"

/** Every background job; queues are created at start. Features add their definitions here. */
export const jobDefinitions: ReadonlyArray<JobDefinition> = [boardRebalance, dueSoonJob, overdueJob]

/** Reminders run hourly, on the hour, in UTC. */
const REMINDER_CRON = "0 * * * *"

const asSystem = Effect.provideService(CurrentActor, {
  _tag: "system",
  reason: "reminders",
} as const)

/** Registers every worker and the reminder schedule once the job queue is running. */
export const jobWorkersLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const jobs = yield* Jobs
    const context = yield* Effect.context<Db | SqlClient.SqlClient | Authz | EventBus>()
    yield* jobs.work(boardRebalance, ({ boardId }) =>
      rebalanceBoard(boardId).pipe(Effect.provide(context)),
    )
    yield* jobs.work(dueSoonJob, () =>
      remindDueSoon.execute({}).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.work(overdueJob, () =>
      remindOverdue.execute({}).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.schedule(dueSoonJob, REMINDER_CRON, {})
    yield* jobs.schedule(overdueJob, REMINDER_CRON, {})
  }),
)
