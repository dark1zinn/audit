/**
 * Realtime fan-out over `/rpc`. Every committed domain event gets a server-wide sequence number and
 * stays in a five-minute replay buffer; subscribers get the events in their scopes that they may
 * see, checked per event, and replay missed events after a reconnect.
 */
import { Authz } from "@audit/core/authz"
import { EventBus } from "@audit/core/event-bus"
import { projects } from "@audit/db/schema"
import { CurrentActor } from "@audit/domain/actor"
import {
  type DomainEvent,
  type Hello,
  type RealtimeMessage,
  RealtimeRpcs,
  type SubscribeInput,
} from "@audit/domain/events"
import { Db } from "@audit/platform/database"
import { inArray } from "drizzle-orm"
import { Context, Effect, Layer, PubSub, Stream } from "effect"

const BUFFER_MS = 5 * 60_000

interface Sequenced {
  readonly seq: number
  readonly at: number
  readonly event: DomainEvent
}

/** Events about the workspace itself go to every `workspace` subscriber. */
const workspaceEvents: Partial<Record<DomainEvent["_tag"], true>> = {
  MembersChanged: true,
  InvitesChanged: true,
  TeamsChanged: true,
  WorkspaceUpdated: true,
  ProfileUpdated: true,
}

interface Subscription {
  readonly workspace: boolean
  readonly projectIds: ReadonlySet<string>
  readonly entityIds: ReadonlySet<string>
}

const inScope = (subscription: Subscription, event: DomainEvent) =>
  (subscription.workspace && workspaceEvents[event._tag] === true) ||
  (event.projectId !== null && subscription.projectIds.has(event.projectId)) ||
  (event.entityId !== null && subscription.entityIds.has(event.entityId))

export interface RealtimeShape {
  readonly subscribe: (
    input: SubscribeInput,
  ) => Stream.Stream<Hello | RealtimeMessage, never, CurrentActor>
}

export class Realtime extends Context.Service<Realtime, RealtimeShape>()("@audit/server/Realtime") {
  static readonly layer = Layer.effect(
    Realtime,
    Effect.gen(function* () {
      const bus = yield* EventBus
      const authz = yield* Authz
      const db = yield* Db
      /** A fresh id per process start: resuming across restarts always resyncs. */
      const bootId = Bun.randomUUIDv7()
      const buffer: Array<Sequenced> = []
      const live = yield* Effect.acquireRelease(PubSub.unbounded<Sequenced>(), PubSub.shutdown)
      let seq = 0

      const events = yield* bus.subscribe
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.suspend(() => {
            const now = Date.now()
            const item = { seq: ++seq, at: now, event }
            buffer.push(item)
            while (buffer.length > 0 && buffer[0]!.at < now - BUFFER_MS) buffer.shift()
            return PubSub.publish(live, item)
          }),
        ),
        Effect.forkScoped,
      )

      const resolveScopes = (scopes: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const keys = scopes.filter((s) => s.startsWith("project:")).map((s) => s.slice(8))
          const rows =
            keys.length === 0
              ? []
              : yield* db
                  .select({ id: projects.id })
                  .from(projects)
                  .where(inArray(projects.key, keys))
                  .pipe(Effect.orDie)
          return {
            workspace: scopes.includes("workspace"),
            projectIds: new Set(rows.map((r) => r.id)),
            entityIds: new Set(
              scopes
                .filter((s) => s.startsWith("entity:") || s.startsWith("channel:"))
                .map((s) => s.slice(s.indexOf(":") + 1)),
            ),
          } satisfies Subscription
        })

      const visible = (event: DomainEvent) =>
        event.entityId === null ? Effect.succeed(true) : authz.can("entity.read", event.entityId)

      const deliver = (subscription: Subscription) => (item: Sequenced) =>
        inScope(subscription, item.event)
          ? Effect.map(visible(item.event), (ok) =>
              ok ? [{ _tag: "Event" as const, seq: item.seq, event: item.event }] : [],
            )
          : Effect.succeed([])

      return Realtime.of({
        subscribe: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* resolveScopes(input.scopes)
              const queue = yield* PubSub.subscribe(live)
              const resume = input.resume
              const oldest = buffer[0]?.seq ?? seq + 1
              const canReplay =
                resume !== undefined &&
                resume.connectionId === bootId &&
                resume.lastSeq >= oldest - 1
              const replayed = canReplay ? buffer.filter((item) => item.seq > resume.lastSeq) : []
              const lastReplayed = replayed.at(-1)?.seq ?? (canReplay ? resume.lastSeq : seq)
              const hello = Stream.make({ _tag: "Hello" as const, connectionId: bootId })
              const head =
                resume === undefined || canReplay
                  ? Stream.empty
                  : Stream.make({ _tag: "Resync" as const, reason: "missed events" })
              const replay = Stream.fromIterable(replayed).pipe(
                Stream.mapEffect(deliver(subscription)),
                Stream.flatMap(Stream.fromIterable),
              )
              const tail = Stream.fromSubscription(queue).pipe(
                Stream.filter((item) => item.seq > lastReplayed),
                Stream.mapEffect(deliver(subscription)),
                Stream.flatMap(Stream.fromIterable),
              )
              return Stream.concat(hello, Stream.concat(head, Stream.concat(replay, tail)))
            }),
          ),
      })
    }),
  )
}

export const RealtimeRpcLive = RealtimeRpcs.toLayer(
  Effect.gen(function* () {
    const realtime = yield* Realtime
    return {
      "realtime.subscribe": (input) => realtime.subscribe(input),
    }
  }),
)
