/**
 * Re-embedding after an embedding model or dimension change: every vector is dropped, the vector
 * column is retyped to the new dimension, and each indexable entity is re-synced. Chunk text is
 * rebuilt by the sync, so full-text retrieval keeps working while vectors are back-filled.
 */
import { Db } from "@audit/platform/database"
import { defineJob, Jobs } from "@audit/platform/jobs"
import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { record } from "../trail.ts"
import { currentEmbeddingModel } from "./embeddings.ts"
import { INDEXABLE_TYPES } from "./sources.ts"
import { embeddingSyncJob } from "./sync.ts"

export const reembedJob = defineJob("ai.reembed", Schema.Struct({}))

/** Vector dimensions the column may take; the HNSW index caps at 4000. */
const MAX_DIMENSIONS = 4000

export const reembedAll = Command.make("ai.reembed.run", {
  input: Schema.Struct({}),
  output: Schema.Struct({ queued: Schema.Number }),
  authorize: () => Effect.void,
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const jobs = yield* Jobs
      const model = yield* currentEmbeddingModel
      const dims = model?.dimensions ?? null
      if (dims !== null && (!Number.isInteger(dims) || dims < 1 || dims > MAX_DIMENSIONS)) {
        return yield* Effect.die(new Error(`unsupported embedding dimensions: ${dims}`))
      }

      yield* db.execute(sql`delete from embeddings`).pipe(Effect.orDie)
      if (dims !== null) {
        // Dimension is validated above, so splicing it into the type name is safe.
        yield* db
          .execute(
            sql`alter table embeddings alter column vector type halfvec(${sql.raw(String(dims))})`,
          )
          .pipe(Effect.orDie)
      }

      const entities = yield* db
        .execute<{ id: string }>(sql`
          select id from entities
          where deleted_at is null and type in (${sql.join(
            INDEXABLE_TYPES.map((t) => sql`${t}`),
            sql`, `,
          )})`)
        .pipe(
          Effect.map((result) => result.rows),
          Effect.orDie,
        )
      for (const entity of entities) {
        yield* jobs.enqueue(embeddingSyncJob, { entityId: entity.id })
      }
      yield* record({ action: "ai.reembedded", details: { count: entities.length } })
      return { queued: entities.length }
    }),
})
