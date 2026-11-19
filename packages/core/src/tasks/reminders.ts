/**
 * Hourly reminders. Each task notifies its assignees once per due date: the `dueNotifiedAt` and
 * `overdueNotifiedAt` markers are cleared whenever the due date changes.
 */
import { entities, projects, taskAssignees, tasks } from "@audit/db/schema"
import type { ProjectId, TaskId, UserId } from "@audit/domain/ids"
import { defineJob } from "@audit/platform/jobs"
import { Db } from "@audit/platform/database"
import { and, eq, gt, isNull, lte } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { notify } from "./notify.ts"

const DAY_MS = 24 * 60 * 60 * 1000

interface DueRow {
  readonly id: TaskId
  readonly projectId: ProjectId
  readonly title: string
  readonly key: string
  readonly dueAt: Date
}

const dueRows = (kind: "due_soon" | "overdue", now: Date) =>
  Effect.gen(function* () {
    const db = yield* Db
    const window =
      kind === "due_soon"
        ? and(
            gt(tasks.dueAt, now),
            lte(tasks.dueAt, new Date(now.getTime() + DAY_MS)),
            isNull(tasks.dueNotifiedAt),
          )
        : and(lte(tasks.dueAt, now), isNull(tasks.overdueNotifiedAt))
    const rows = yield* db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        title: entities.title,
        number: tasks.number,
        projectKey: projects.key,
        dueAt: tasks.dueAt,
      })
      .from(tasks)
      .innerJoin(entities, eq(entities.id, tasks.id))
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(isNull(entities.deletedAt), isNull(tasks.completedAt), window))
      .pipe(Effect.orDie)
    return rows.flatMap((row): DueRow[] =>
      row.dueAt === null
        ? []
        : [
            {
              id: row.id as TaskId,
              projectId: row.projectId as ProjectId,
              title: row.title,
              key: `${row.projectKey}-${row.number}`,
              dueAt: row.dueAt,
            },
          ],
    )
  })

const remindKind = (kind: "due_soon" | "overdue") =>
  Effect.gen(function* () {
    const db = yield* Db
    const now = new Date()
    const rows = yield* dueRows(kind, now)
    for (const row of rows) {
      const assignees = yield* db
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, row.id))
        .pipe(Effect.orDie)
      for (const assignee of assignees) {
        yield* notify({
          userId: assignee.userId as UserId,
          kind: kind === "due_soon" ? "task_due_soon" : "task_overdue",
          entityId: row.id,
          projectId: row.projectId,
          actorId: null,
          payload: { taskKey: row.key, title: row.title, dueAt: row.dueAt.toISOString() },
          groupKey: `${kind}:${row.id}`,
        })
      }
      yield* db
        .update(tasks)
        .set(kind === "due_soon" ? { dueNotifiedAt: now } : { overdueNotifiedAt: now })
        .where(eq(tasks.id, row.id))
        .pipe(Effect.orDie)
    }
  })

export const remindDueSoon = Command.make("tasks.remind_due_soon", {
  input: Schema.Struct({}),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: () => remindKind("due_soon"),
})

export const remindOverdue = Command.make("tasks.remind_overdue", {
  input: Schema.Struct({}),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: () => remindKind("overdue"),
})

export const dueSoonJob = defineJob("tasks.due_soon", Schema.Struct({}))
export const overdueJob = defineJob("tasks.overdue", Schema.Struct({}))
