/**
 * Domain events, published after a command commits. Consumers: realtime fan-out, notifications,
 * search indexing, embeddings and AI doc upkeep. Each feature adds its events to `DomainEvent`.
 */
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Unauthorized } from "./errors.ts"
import { RpcAuthentication } from "./http.ts"
import { EntityId, ProjectId, UserId } from "./ids.ts"

/** Fields every event carries so fan-out can filter by scope and permission. */
const base = {
  /** Entity the event is about; permission checks use it. `null` for workspace-level events. */
  entityId: Schema.NullOr(EntityId),
  projectId: Schema.NullOr(ProjectId),
  actorId: Schema.NullOr(UserId),
  /** New entity version for optimistic concurrency, when the entity has one. */
  version: Schema.NullOr(Schema.Int),
}

export const MembersChanged = Schema.TaggedStruct("MembersChanged", {
  ...base,
  userId: UserId,
})
export const InvitesChanged = Schema.TaggedStruct("InvitesChanged", base)
export const TeamsChanged = Schema.TaggedStruct("TeamsChanged", base)
export const WorkspaceUpdated = Schema.TaggedStruct("WorkspaceUpdated", base)
export const ProfileUpdated = Schema.TaggedStruct("ProfileUpdated", { ...base, userId: UserId })

export const DomainEvent = Schema.Union([
  MembersChanged,
  InvitesChanged,
  TeamsChanged,
  WorkspaceUpdated,
  ProfileUpdated,
])
export type DomainEvent = typeof DomainEvent.Type

/**
 * Subscription scopes: `workspace` (members, teams, settings), `project:<KEY>`, `channel:<id>`,
 * `entity:<id>` and `inbox` (the subscriber's notifications).
 */
export const Scope = Schema.String.check(
  Schema.isPattern(
    /^(workspace|inbox|project:[A-Z]{2,6}|channel:[0-9a-f-]{36}|entity:[0-9a-f-]{36})$/,
  ),
)

export const RealtimeEvent = Schema.TaggedStruct("Event", {
  /** Per-connection sequence; the client sends the last one back when it reconnects. */
  seq: Schema.Int,
  event: DomainEvent,
})
/** The replay buffer no longer covers the gap: refetch everything in the subscribed scopes. */
export const RealtimeResync = Schema.TaggedStruct("Resync", { reason: Schema.String })
export const RealtimeMessage = Schema.Union([RealtimeEvent, RealtimeResync])
export type RealtimeMessage = typeof RealtimeMessage.Type

export const SubscribeInput = Schema.Struct({
  scopes: Schema.Array(Scope),
  /** Connection id and last sequence from a previous connection, to replay missed events. */
  resume: Schema.optionalKey(Schema.Struct({ connectionId: Schema.String, lastSeq: Schema.Int })),
})

export const Hello = Schema.TaggedStruct("Hello", { connectionId: Schema.String })

export class RealtimeRpcs extends RpcGroup.make(
  Rpc.make("realtime.subscribe", {
    payload: SubscribeInput,
    success: Schema.Union([Hello, RealtimeEvent, RealtimeResync]),
    error: Unauthorized,
    stream: true,
  }),
).middleware(RpcAuthentication) {}
