import { entities, files, workspace } from "@audit/db/schema"
import { NotFound } from "@audit/domain/errors"
import type { FileLimits } from "@audit/domain/files/schema"
import type { FileId } from "@audit/domain/ids"
import { defaultWorkspaceSettings, type WorkspaceSettings } from "@audit/domain/identity/schema"
import { BlobStore } from "@audit/platform/blob-store"
import { Db } from "@audit/platform/database"
import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Authz } from "../authz.ts"

const MEGABYTE = 1024 * 1024
const GIGABYTE = 1024 * MEGABYTE

/** Upload limit and storage quota from the workspace settings, plus what is stored so far. */
export const fileLimits = Effect.gen(function* () {
  const db = yield* Db
  const [row] = yield* db.select({ settings: workspace.settings }).from(workspace)
  const settings: WorkspaceSettings = {
    ...defaultWorkspaceSettings,
    ...(row?.settings as Partial<WorkspaceSettings> | undefined),
  }
  const [usage] = yield* db
    .select({ used: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
  const limits: FileLimits = {
    uploadLimitBytes: settings.uploadLimitMb * MEGABYTE,
    quotaBytes: settings.storageQuotaGb * GIGABYTE,
    usedBytes: Number(usage?.used ?? 0),
  }
  return limits
}).pipe(Effect.orDie)

export interface OpenedFile {
  readonly body: Blob
  readonly mime: string
  readonly name: string
}

/**
 * Opens a file (or its thumbnail) for download after the access check on the file itself
 * (`file.read`, which resolves through its parent). Invisible, deleted and unreferenced files are
 * not found.
 */
export const openFile = (fileId: FileId, variant: "original" | "thumbnail") =>
  Effect.gen(function* () {
    const authz = yield* Authz
    const db = yield* Db
    const blobs = yield* BlobStore
    yield* authz.requireOn("file.read", fileId)
    const [row] = yield* db
      .select({
        name: files.name,
        mime: files.mime,
        storageKey: files.storageKey,
        thumbnailKey: files.thumbnailKey,
      })
      .from(files)
      .innerJoin(entities, eq(entities.id, files.id))
      .where(and(eq(files.id, fileId), isNull(entities.deletedAt), isNull(files.unreferencedAt)))
      .pipe(Effect.orDie)
    const key =
      row === undefined ? null : variant === "thumbnail" ? row.thumbnailKey : row.storageKey
    if (row === undefined || key === null) {
      return yield* new NotFound({ entity: "file", id: fileId })
    }
    const body = yield* blobs.get(key).pipe(Effect.orDie)
    if (body === null) return yield* new NotFound({ entity: "file", id: fileId })
    const opened: OpenedFile =
      variant === "thumbnail"
        ? { body, mime: "image/webp", name: row.name }
        : { body, mime: row.mime, name: row.name }
    return opened
  })
