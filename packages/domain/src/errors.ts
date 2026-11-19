/**
 * Errors shared by every command and query. Each carries its HTTP status so it keeps its type from
 * the command layer through HttpApi and RPC to the UI.
 */
import { Schema } from "effect"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { action: Schema.String, message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { entity: Schema.String, id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** A stale write or a uniqueness clash; `current` holds the latest state when there is one. */
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String, current: Schema.optionalKey(Schema.Unknown) },
  { httpApiStatus: 409 },
) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { message: Schema.String, field: Schema.optionalKey(Schema.String) },
  { httpApiStatus: 422 },
) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  { retryAfterSeconds: Schema.Finite },
  { httpApiStatus: 429 },
) {}

/** The errors any command may fail with. */
export const CommandError = Schema.Union([
  Forbidden,
  NotFound,
  Conflict,
  ValidationError,
  RateLimited,
])
export type CommandError = typeof CommandError.Type
