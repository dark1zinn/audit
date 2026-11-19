import { Schema } from "effect"
import { FileId } from "../ids.ts"

/** A stored file as the client sees it. `thumbnailUrl` is null for anything without a thumbnail. */
export const FileRef = Schema.Struct({
  id: FileId,
  name: Schema.String,
  mime: Schema.String,
  size: Schema.Int,
  url: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
})
export type FileRef = typeof FileRef.Type

/** Limits the workspace enforces on uploads, read from its settings. */
export const FileLimits = Schema.Struct({
  uploadLimitBytes: Schema.Int,
  quotaBytes: Schema.Int,
  usedBytes: Schema.Int,
})
export type FileLimits = typeof FileLimits.Type
