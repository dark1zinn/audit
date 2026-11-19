/**
 * Doc compaction. A Yjs state keeps the edit history it was built from, so a long-edited doc grows
 * far beyond its content. Re-encoding the stored JSON gives a compact state with the same content.
 *
 * Each replaced state is kept as an auto version first. Docs open in a collaboration session are
 * skipped, and so are docs edited while the job runs (the stored state no longer matches what was read).
 */
import { docs, entities } from "@audit/db/schema"
import type { DocId } from "@audit/domain/ids"
import { isJsonNode } from "@audit/editor/json"
import { jsonToState } from "@audit/editor/ydoc"
import { Db } from "@audit/platform/database"
import { defineJob } from "@audit/platform/jobs"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { record } from "../trail.ts"
import { LiveDocuments } from "./live-documents.ts"
import { insertVersion } from "./versions.ts"

/** Docs whose stored Yjs state is larger than this are compacted. */
export const COMPACTION_THRESHOLD_BYTES = 256 * 1024

/** Daily, after the trail retention and before the doc freshness sweep. */
export const DOC_COMPACTION_CRON = "0 5 * * *"

const CompactionInput = Schema.Struct({ thresholdBytes: Schema.optional(Schema.Number) })

/** `count` is the number of docs compacted; the rest describe what was done. */
export const CompactionResult = Schema.Struct({
  count: Schema.Number,
  skipped: Schema.Number,
  bytesBefore: Schema.Number,
  bytesAfter: Schema.Number,
})

export const docsCompactJob = defineJob("docs.compact", CompactionInput)

/** Rebuilds the state of every large doc from its JSON, when that is smaller. */
export const compactDocs = Command.make("docs.compact", {
  input: CompactionInput,
  output: CompactionResult,
  authorize: () =>
    Effect.gen(function* () {
      const authz = yield* Authz
      yield* authz.requireCapability("workspace.settings")
    }),
  run: ({ thresholdBytes = COMPACTION_THRESHOLD_BYTES }) =>
    Effect.gen(function* () {
      const db = yield* Db
      const live = yield* LiveDocuments
      const candidates = yield* db
        .select({ id: docs.id })
        .from(docs)
        .innerJoin(entities, eq(entities.id, docs.id))
        .where(and(isNull(entities.deletedAt), sql`octet_length(${docs.ydoc}) > ${thresholdBytes}`))
        .pipe(Effect.orDie)

      let count = 0
      let skipped = 0
      let bytesBefore = 0
      let bytesAfter = 0
      for (const { id } of candidates) {
        const docId = id as DocId
        if (live.isOpen(docId)) {
          skipped++
          continue
        }
        const [row] = yield* db
          .select({ ydoc: docs.ydoc, content: docs.content })
          .from(docs)
          .where(eq(docs.id, docId))
          .pipe(Effect.orDie)
        if (!row?.ydoc || !isJsonNode(row.content)) continue
        const rebuilt = jsonToState(row.content)
        if (rebuilt.byteLength >= row.ydoc.byteLength) continue

        // Compare-and-set: an edit that landed since the read leaves the doc as it is.
        const replaced = yield* db
          .update(docs)
          .set({ ydoc: rebuilt })
          .where(and(eq(docs.id, docId), eq(docs.ydoc, row.ydoc)))
          .returning({ id: docs.id })
          .pipe(Effect.orDie)
        if (replaced.length === 0) {
          skipped++
          continue
        }
        yield* insertVersion(
          docId,
          { snapshot: row.ydoc, content: row.content },
          "auto",
          "Before compaction",
          null,
        )
        count++
        bytesBefore += row.ydoc.byteLength
        bytesAfter += rebuilt.byteLength
      }

      const result = { count, skipped, bytesBefore, bytesAfter }
      yield* record({ action: "docs.compacted", details: result })
      return result
    }),
})
