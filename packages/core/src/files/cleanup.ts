/**
 * Orphan cleanup: files whose parent was deleted, or that stayed unreferenced for the retention
 * window, are purged (row and blobs). Runs as the system actor from the daily job.
 */
import { files } from "@audit/db/schema"
import type { FileId } from "@audit/domain/ids"
import { defineJob } from "@audit/platform/jobs"
import { BlobStore } from "@audit/platform/blob-store"
import { Db } from "@audit/platform/database"
import { and, isNotNull, lt } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { markOrphanedFiles, purgeFile } from "./commands.ts"

const DAY_MS = 24 * 60 * 60 * 1000
export const ORPHAN_RETENTION_DAYS = 7

const deleteBlob = (key: string) =>
  Effect.gen(function* () {
    const blobs = yield* BlobStore
    yield* blobs
      .delete(key)
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not delete a purged file's blob", { key, error }),
        ),
      )
  })

/** Marks newly orphaned files, then purges those unreferenced past the retention window. */
export const cleanupOrphanedFiles = Effect.gen(function* () {
  const db = yield* Db
  yield* markOrphanedFiles.execute({})
  const cutoff = new Date(Date.now() - ORPHAN_RETENTION_DAYS * DAY_MS)
  const due = yield* db
    .select({ id: files.id })
    .from(files)
    .where(and(isNotNull(files.unreferencedAt), lt(files.unreferencedAt, cutoff)))
    .pipe(Effect.orDie)
  let purged = 0
  for (const { id } of due) {
    const removed = yield* purgeFile.execute({ fileId: id as FileId })
    yield* deleteBlob(removed.storageKey)
    if (removed.thumbnailKey !== null) yield* deleteBlob(removed.thumbnailKey)
    purged += 1
  }
  return { purged }
})

export const orphanCleanupJob = defineJob("files.cleanup", Schema.Struct({}))
