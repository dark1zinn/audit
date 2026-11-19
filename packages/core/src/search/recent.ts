import { entities, recentItems } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { RecordRecentInput } from "@audit/domain/search/schema"
import { Db } from "@audit/platform/database"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"

/**
 * Marks an item as opened by the caller for the quick find's recent list. Items the caller cannot
 * see are ignored, so the call never reveals that a hidden item exists.
 */
export const recordRecent = Command.make("search.recordRecent", {
  input: RecordRecentInput,
  output: Schema.Void,
  authorize: () => Effect.void,
  run: ({ entityId }) =>
    Effect.gen(function* () {
      const userId = actorUserId(yield* CurrentActor)
      if (userId === null) return
      const db = yield* Db
      const authz = yield* Authz
      const visible = yield* authz.visible(sql`${entities.id}`)
      const [visibleRow] = yield* db
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.id, entityId), isNull(entities.deletedAt), visible))
        .pipe(Effect.orDie)
      if (visibleRow === undefined) return
      yield* db
        .insert(recentItems)
        .values({ userId, entityId, viewedAt: new Date() })
        .onConflictDoUpdate({
          target: [recentItems.userId, recentItems.entityId],
          set: { viewedAt: sql`now()` },
        })
        .pipe(Effect.orDie)
    }),
})
