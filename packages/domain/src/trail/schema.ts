import { Schema } from "effect"
import { EntityId, ProjectId, TrailEventId, UserId } from "../ids.ts"

export const TrailActorType = Schema.Literals(["user", "ai", "system"])
export type TrailActorType = typeof TrailActorType.Type

/** Field-level change: `[before, after]` per changed field. */
export const TrailDiff = Schema.Record(
  Schema.String,
  Schema.Tuple([Schema.Unknown, Schema.Unknown]),
)
export type TrailDiff = typeof TrailDiff.Type

export const TrailMeta = Schema.Struct({
  ip: Schema.optionalKey(Schema.String),
  userAgent: Schema.optionalKey(Schema.String),
  requestId: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})
export type TrailMeta = typeof TrailMeta.Type

export const TrailEvent = Schema.Struct({
  id: TrailEventId,
  seq: Schema.Int,
  at: Schema.Date,
  actorType: TrailActorType,
  actorId: Schema.NullOr(UserId),
  actorName: Schema.NullOr(Schema.String),
  onBehalfOf: Schema.NullOr(UserId),
  action: Schema.String,
  entityId: Schema.NullOr(EntityId),
  entityType: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(ProjectId),
  diff: Schema.NullOr(TrailDiff),
  meta: TrailMeta,
})
export type TrailEvent = typeof TrailEvent.Type

export const TrailFilter = Schema.Struct({
  actorId: Schema.optionalKey(UserId),
  action: Schema.optionalKey(Schema.String),
  entityId: Schema.optionalKey(EntityId),
  projectId: Schema.optionalKey(ProjectId),
  from: Schema.optionalKey(Schema.Date),
  to: Schema.optionalKey(Schema.Date),
  /** Return events with `seq` below this cursor (newest first). */
  before: Schema.optionalKey(Schema.Int),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})
export type TrailFilter = typeof TrailFilter.Type

export const TrailPage = Schema.Struct({
  events: Schema.Array(TrailEvent),
  nextBefore: Schema.NullOr(Schema.Int),
})
export type TrailPage = typeof TrailPage.Type

export const TrailVerification = Schema.Struct({
  ok: Schema.Boolean,
  checked: Schema.Int,
  firstBrokenSeq: Schema.NullOr(Schema.Int),
})
export type TrailVerification = typeof TrailVerification.Type
