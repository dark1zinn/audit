/**
 * Doc review freshness. A doc is due for review once `reviewEveryDays` have passed since it was
 * last verified (or created). Its owner is notified at most once per review interval.
 */
import { docs, entities } from "@audit/db/schema"
import type { EntityId, ProjectId, UserId } from "@audit/domain/ids"
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { notify } from "../tasks/notify.ts"

export const docFreshness = Command.make("docs.freshness", {
  input: Schema.Struct({}),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const now = new Date()
      const rows = yield* db
        .select({
          id: docs.id,
          title: entities.title,
          projectId: docs.projectId,
          ownerUserId: docs.ownerUserId,
        })
        .from(docs)
        .innerJoin(entities, eq(entities.id, docs.id))
        .where(
          and(
            isNull(entities.deletedAt),
            isNotNull(docs.ownerUserId),
            isNotNull(docs.reviewEveryDays),
            sql`coalesce(${docs.verifiedAt}, ${entities.createdAt}) + make_interval(days => ${docs.reviewEveryDays}) <= ${now}`,
            or(
              isNull(docs.reviewNotifiedAt),
              sql`${docs.reviewNotifiedAt} <= ${now} - make_interval(days => ${docs.reviewEveryDays})`,
            ),
          ),
        )
        .pipe(Effect.orDie)
      for (const row of rows) {
        if (row.ownerUserId === null) continue
        yield* notify({
          userId: row.ownerUserId as UserId,
          kind: "doc_review_due",
          entityId: row.id as EntityId,
          projectId: row.projectId as ProjectId | null,
          actorId: null,
          payload: { title: row.title, docId: row.id },
          groupKey: `doc_review:${row.id}`,
        })
        yield* db
          .update(docs)
          .set({ reviewNotifiedAt: now })
          .where(eq(docs.id, row.id))
          .pipe(Effect.orDie)
      }
    }),
})

export const docFreshnessJob = defineJob("docs.freshness", Schema.Struct({}))
