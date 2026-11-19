/**
 * Keeps an entity's chunks and their vectors in step with its content. The work is split so no
 * external model call runs inside a database transaction:
 *
 *   1. `prepareIndex` (command) writes chunk text and hashes, and returns the chunks that still
 *      need a vector (new, changed, or embedded with another model).
 *   2. the job calls the embedding model outside any transaction.
 *   3. `storeVectors` (command) writes the vectors, only where the hash still matches.
 *
 * Unchanged chunks keep their vector and are never sent to the model again.
 */
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import * as Command from "../command.ts"
import { currentEmbeddingModel, embedTexts } from "./embeddings.ts"
import { contentHash } from "./chunk.ts"
import { loadChunks } from "./sources.ts"

export const embeddingSyncJob = defineJob(
  "ai.embed-entity",
  Schema.Struct({ entityId: Schema.String }),
)

const Item = Schema.Struct({ chunk: Schema.Number, hash: Schema.String, text: Schema.String })

export const prepareIndex = Command.make("ai.index.prepare", {
  input: Schema.Struct({ entityId: Schema.String }),
  output: Schema.Struct({ needsVector: Schema.Array(Item) }),
  authorize: () => Effect.void,
  run: ({ entityId }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const loaded = yield* loadChunks(entityId)
      const model = yield* currentEmbeddingModel
      const chunks = loaded?.chunks ?? []
      const items = chunks.map((c) => ({ ...c, hash: contentHash(c.text) }))

      yield* db
        .execute(
          sql`delete from embeddings where entity_id = ${entityId} and chunk >= ${items.length}`,
        )
        .pipe(Effect.orDie)
      for (const item of items) {
        // A changed hash clears the vector; an unchanged one keeps it.
        yield* db
          .execute(sql`
            insert into embeddings (entity_id, chunk, text, content_hash)
            values (${entityId}, ${item.chunk}, ${item.text}, ${item.hash})
            on conflict (entity_id, chunk) do update set
              text = excluded.text,
              vector = case when embeddings.content_hash = excluded.content_hash
                then embeddings.vector else null end,
              model = case when embeddings.content_hash = excluded.content_hash
                then embeddings.model else null end,
              content_hash = excluded.content_hash`)
          .pipe(Effect.orDie)
      }

      if (model === null) return { needsVector: [] }
      const embedded = yield* db
        .execute<{ chunk: number; content_hash: string }>(sql`
          select chunk, content_hash from embeddings
          where entity_id = ${entityId} and model = ${model.model} and vector is not null`)
        .pipe(
          Effect.map((result) => result.rows),
          Effect.orDie,
        )
      const done = new Set(embedded.map((row) => `${row.chunk}:${row.content_hash}`))
      const needsVector = items
        .filter((item) => !done.has(`${item.chunk}:${item.hash}`))
        .map(({ chunk, hash, text }) => ({ chunk, hash, text }))
      return { needsVector }
    }),
})

export const storeVectors = Command.make("ai.index.store", {
  input: Schema.Struct({
    entityId: Schema.String,
    model: Schema.String,
    vectors: Schema.Array(
      Schema.Struct({
        chunk: Schema.Number,
        hash: Schema.String,
        vector: Schema.Array(Schema.Number),
      }),
    ),
  }),
  output: Schema.Struct({ stored: Schema.Number }),
  authorize: () => Effect.void,
  run: ({ entityId, model, vectors }) =>
    Effect.gen(function* () {
      const db = yield* Db
      for (const { chunk, hash, vector } of vectors) {
        yield* db
          .execute(sql`
            update embeddings set vector = ${`[${vector.join(",")}]`}::halfvec, model = ${model}
            where entity_id = ${entityId} and chunk = ${chunk} and content_hash = ${hash}`)
          .pipe(Effect.orDie)
      }
      return { stored: vectors.length }
    }),
})

/** One entity's sync: prepare, embed outside the transaction, store. A no-op without a model. */
export const syncEntity = (entityId: string) =>
  Effect.gen(function* () {
    const prepared = yield* prepareIndex.execute({ entityId })
    if (prepared.needsVector.length === 0) return
    const embedded = yield* embedTexts(prepared.needsVector.map((item) => item.text)).pipe(
      Effect.catch(() => Effect.succeed(null)),
    )
    if (embedded === null || embedded.vectors.length !== prepared.needsVector.length) return
    yield* storeVectors.execute({
      entityId,
      model: embedded.model,
      vectors: prepared.needsVector.map((item, index) => ({
        chunk: item.chunk,
        hash: item.hash,
        vector: [...(embedded.vectors[index] ?? [])],
      })),
    })
  })
