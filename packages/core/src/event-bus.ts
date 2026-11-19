/**
 * In-process publication of domain events after commit. A second instance would bridge this with
 * Postgres LISTEN/NOTIFY.
 */
import type { DomainEvent } from "@audit/domain/events"
import { Context, Effect, Layer, PubSub, type Scope, Stream } from "effect"

export interface EventBusShape {
  readonly publish: (events: ReadonlyArray<DomainEvent>) => Effect.Effect<void>
  /** Events published after subscription; lagging subscribers drop the oldest events. */
  readonly subscribe: Effect.Effect<Stream.Stream<DomainEvent>, never, Scope.Scope>
}

export class EventBus extends Context.Service<EventBus, EventBusShape>()("@audit/core/EventBus") {
  static readonly layer = Layer.effect(
    EventBus,
    Effect.gen(function* () {
      const pubsub = yield* Effect.acquireRelease(
        PubSub.sliding<DomainEvent>(4096),
        PubSub.shutdown,
      )
      return EventBus.of({
        publish: (events) => PubSub.publishAll(pubsub, events).pipe(Effect.asVoid),
        subscribe: Effect.map(PubSub.subscribe(pubsub), Stream.fromSubscription),
      })
    }),
  )
}
