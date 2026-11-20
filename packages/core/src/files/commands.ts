import { entities, files } from "@audit/db/schema"
import { CurrentActor } from "@audit/domain/actor"
import { Forbidden, NotFound, ValidationError } from "@audit/domain/errors"
import { FileRef } from "@audit/domain/files/schema"
import { EntityId, FileId, type ProjectId } from "@audit/domain/ids"
import { BlobStore } from "@audit/platform/blob-store"
import { Db } from "@audit/platform/database"
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Effect, Schema } from "effect"
import { Authz } from "../authz.ts"
import * as Command from "../command.ts"
import { currentUser } from "../current-user.ts"
import { createEntity, softDeleteEntity } from "../entities.ts"
import { record } from "../trail.ts"
import { cleanFileName, makeThumbnail, sha256Hex, sniffMime } from "./media.ts"
import { assertWritable } from "../projects/read.ts"
import { fileLimits } from "./queries.ts"

const MEGABYTE = 1024 * 1024

/** The entity row a file hangs off (its access parent). Missing or deleted parents are not found. */
const parentRow = (id: EntityId) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({
        type: entities.type,
        projectId: entities.projectId,
        deletedAt: entities.deletedAt,
      })
      .from(entities)
      .where(eq(entities.id, id))
      .pipe(Effect.orDie)
    if (row === undefined || row.deletedAt !== null) {
      return yield* new NotFound({ entity: "entity", id })
    }
    return { ...row, projectId: row.projectId as ProjectId | null }
  })

const requireSystem = (action: string) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor
    if (actor._tag !== "system") {
      return yield* new Forbidden({ action, message: "Only background jobs can do this" })
    }
  })

export const UploadFileInput = Schema.Struct({
  parentId: EntityId,
  name: Schema.String,
  bytes: Schema.Uint8Array,
})

/**
 * Stores an uploaded file. Editors upload onto documents, tasks and the like; commenters may
 * attach to comments and messages. The MIME type is sniffed from the bytes.
 */
export const uploadFile = Command.make("file.upload", {
  input: UploadFileInput,
  output: FileRef,
  authorize: (input) =>
    Effect.gen(function* () {
      const authz = yield* Authz
      const parent = yield* parentRow(input.parentId)
      const commentable = parent.type === "comment" || parent.type === "message"
      yield* authz.requireOn(commentable ? "file.comment" : "file.create", input.parentId)
      if (parent.projectId !== null) yield* assertWritable(parent.projectId)
    }),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const blobs = yield* BlobStore
      const userId = yield* currentUser("file.upload")
      const parent = yield* parentRow(input.parentId)
      const limits = yield* fileLimits
      const size = input.bytes.byteLength
      if (size === 0) {
        return yield* new ValidationError({ message: "The file is empty", field: "file" })
      }
      if (size > limits.uploadLimitBytes) {
        const mb = Math.round(limits.uploadLimitBytes / MEGABYTE)
        return yield* new ValidationError({
          message: `The file is larger than the ${mb} MB upload limit`,
          field: "file",
        })
      }
      if (limits.usedBytes + size > limits.quotaBytes) {
        return yield* new ValidationError({
          message: "The workspace storage quota is full",
          field: "file",
        })
      }

      const name = cleanFileName(input.name)
      const mime = yield* Effect.promise(() => sniffMime(input.bytes))
      const sha256 = sha256Hex(input.bytes)
      const thumbnail = yield* Effect.promise(() => makeThumbnail(input.bytes, mime))
      const id = Bun.randomUUIDv7() as FileId
      const storageKey = `originals/${id}`
      const thumbnailKey = thumbnail === null ? null : `thumbnails/${id}.webp`

      // Blobs go first: a failed insert leaves an unreferenced blob, never a row without bytes.
      yield* blobs.put(storageKey, input.bytes).pipe(Effect.orDie)
      if (thumbnail !== null && thumbnailKey !== null) {
        yield* blobs.put(thumbnailKey, thumbnail).pipe(Effect.orDie)
      }

      yield* createEntity({
        id,
        type: "file",
        title: name,
        searchText: name,
        parentId: input.parentId,
        projectId: parent.projectId,
      })
      yield* db
        .insert(files)
        .values({
          id,
          storageKey,
          thumbnailKey,
          name,
          mime,
          size,
          sha256,
          uploadedBy: userId,
          scanStatus: "skipped",
        })
        .pipe(Effect.orDie)
      yield* record({
        action: "file.uploaded",
        entityId: id,
        entityType: "file",
        projectId: parent.projectId,
        details: { name, mime, size, parentId: input.parentId },
      })
      return {
        id,
        name,
        mime,
        size,
        url: `/files/${id}`,
        thumbnailUrl: thumbnailKey === null ? null : `/files/${id}/thumb`,
      }
    }),
})

export const PurgeFileInput = Schema.Struct({ fileId: FileId })
export const PurgedFile = Schema.Struct({
  storageKey: Schema.String,
  thumbnailKey: Schema.NullOr(Schema.String),
})

/**
 * Deletes a file's row and tombstones its entity; the caller removes the blobs after commit.
 * System only: users cannot purge.
 */
export const purgeFile = Command.make("file.purge", {
  input: PurgeFileInput,
  output: PurgedFile,
  authorize: () => requireSystem("file.purge"),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db
        .select({
          name: files.name,
          storageKey: files.storageKey,
          thumbnailKey: files.thumbnailKey,
          projectId: entities.projectId,
        })
        .from(files)
        .innerJoin(entities, eq(entities.id, files.id))
        .where(eq(files.id, input.fileId))
        .pipe(Effect.orDie)
      if (row === undefined) return yield* new NotFound({ entity: "file", id: input.fileId })
      yield* db.delete(files).where(eq(files.id, input.fileId)).pipe(Effect.orDie)
      yield* softDeleteEntity(input.fileId)
      yield* record({
        action: "file.deleted",
        entityId: input.fileId,
        entityType: "file",
        projectId: row.projectId as ProjectId | null,
        details: { name: row.name, reason: "orphaned" },
      })
      return { storageKey: row.storageKey, thumbnailKey: row.thumbnailKey }
    }),
})

/** Stamps `unreferenced_at` on files whose own entity or access parent has been deleted. */
export const markOrphanedFiles = Command.make("files.mark_orphaned", {
  input: Schema.Struct({}),
  output: Schema.Struct({ marked: Schema.Int }),
  authorize: () => requireSystem("files.mark_orphaned"),
  run: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const parent = alias(entities, "parent")
      const orphanIds = db
        .select({ id: files.id })
        .from(files)
        .innerJoin(entities, eq(entities.id, files.id))
        .leftJoin(parent, eq(parent.id, entities.parentId))
        .where(
          and(
            isNull(files.unreferencedAt),
            or(isNotNull(entities.deletedAt), isNotNull(parent.deletedAt)),
          ),
        )
      const marked = yield* db
        .update(files)
        .set({ unreferencedAt: new Date() })
        .where(inArray(files.id, orphanIds))
        .returning({ id: files.id })
        .pipe(Effect.orDie)
      if (marked.length > 0) {
        yield* record({ action: "files.unreferenced", details: { count: marked.length } })
      }
      return { marked: marked.length }
    }),
})
