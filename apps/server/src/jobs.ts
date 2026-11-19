import type { Authz } from "@audit/core/authz"
import type { EventBus } from "@audit/core/event-bus"
import { docFreshness, docFreshnessJob } from "@audit/core/docs/freshness"
import { purgeMessages, purgeMessagesJob } from "@audit/core/chat/retention"
import { orphanCleanupJob, cleanupOrphanedFiles } from "@audit/core/files/cleanup"
import { boardRebalance, rebalanceBoard } from "@audit/core/projects/rebalance"
import { dueSoonJob, overdueJob, remindDueSoon, remindOverdue } from "@audit/core/tasks/reminders"
import { calendarReminder, calendarReminderJob } from "@audit/core/calendar/reminders"
import { deliverNotification } from "@audit/core/notifications/deliver"
import { deliverJob } from "@audit/core/notifications/notify"
import type { Mailer } from "@audit/core/notifications/mail"
import type { PushTransport } from "@audit/core/notifications/push"
import { CurrentActor } from "@audit/domain/actor"
import type { BlobStore } from "@audit/platform/blob-store"
import type { Db } from "@audit/platform/database"
import { Jobs, type JobDefinition } from "@audit/platform/jobs"
import { Effect, Layer } from "effect"
import type { SqlClient } from "effect/sql"

/** Every background job; queues are created at start. Features add their definitions here. */
export const jobDefinitions: ReadonlyArray<JobDefinition> = [
  boardRebalance,
  dueSoonJob,
  overdueJob,
  docFreshnessJob,
  orphanCleanupJob,
  purgeMessagesJob,
  calendarReminderJob,
  deliverJob,
]

/** Reminders run hourly, on the hour, in UTC. */
const REMINDER_CRON = "0 * * * *"
/** Orphan file cleanup runs daily at 03:00 UTC. */
const FILE_CLEANUP_CRON = "0 3 * * *"
/** Message retention runs daily at 03:30 UTC, after file cleanup. */
const MESSAGE_RETENTION_CRON = "30 3 * * *"
/** Doc review reminders run daily at 06:00 UTC. */
const DOC_FRESHNESS_CRON = "0 6 * * *"

const asSystem = Effect.provideService(CurrentActor, {
  _tag: "system",
  reason: "reminders",
} as const)

/** Registers every worker and the reminder schedule once the job queue is running. */
export const jobWorkersLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const jobs = yield* Jobs
    const context = yield* Effect.context<
      Db | SqlClient.SqlClient | Authz | EventBus | BlobStore | Jobs | PushTransport | Mailer
    >()
    yield* jobs.work(boardRebalance, ({ boardId }) =>
      rebalanceBoard(boardId).pipe(Effect.provide(context)),
    )
    yield* jobs.work(dueSoonJob, () =>
      remindDueSoon.execute({}).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.work(overdueJob, () =>
      remindOverdue.execute({}).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.work(orphanCleanupJob, () =>
      cleanupOrphanedFiles.pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.work(purgeMessagesJob, () =>
      purgeMessages.execute({}).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.work(docFreshnessJob, () =>
      docFreshness.execute({}).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.work(calendarReminderJob, (data) =>
      calendarReminder.execute(data).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.work(deliverJob, (data) =>
      deliverNotification(data).pipe(asSystem, Effect.provide(context)),
    )
    yield* jobs.schedule(dueSoonJob, REMINDER_CRON, {})
    yield* jobs.schedule(overdueJob, REMINDER_CRON, {})
    yield* jobs.schedule(orphanCleanupJob, FILE_CLEANUP_CRON, {})
    yield* jobs.schedule(purgeMessagesJob, MESSAGE_RETENTION_CRON, {})
    yield* jobs.schedule(docFreshnessJob, DOC_FRESHNESS_CRON, {})
  }),
)
