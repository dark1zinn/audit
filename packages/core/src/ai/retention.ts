/**
 * AI conversation retention: conversations untouched for longer than the window are deleted, with
 * their messages (the foreign key cascades). The purge runs as a nightly job and records a trail
 * entry with how many conversations it removed.
 */
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { record } from "../trail.ts"

/** Days an AI conversation is kept after its last activity. */
export const AI_CONVERSATION_RETENTION_DAYS = 90

export const aiRetentionJob = defineJob("ai.retention", Schema.Struct({}))

export const purgeAiConversations = Command.make("ai.retention.purge", {
  input: Schema.Struct({}),
  output: Schema.Struct({ deleted: Schema.Number }),
  authorize: () => Effect.void,
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const removed = yield* db
        .execute<{ id: string }>(sql`
          delete from ai_conversations
          where updated_at < now() - make_interval(days => ${AI_CONVERSATION_RETENTION_DAYS})
          returning id`)
        .pipe(
          Effect.map((result) => result.rows.length),
          Effect.orDie,
        )
      if (removed > 0)
        yield* record({ action: "ai.conversations_purged", details: { count: removed } })
      return { deleted: removed }
    }),
})
