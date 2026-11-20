/**
 * Closes realtime sockets whose session or document access no longer holds.
 *
 * Sockets authenticate once at upgrade. Changes after that (deactivation, role or 2FA changes,
 * project archive, revoked sessions) must not leave the socket open. Membership changes close the
 * affected user's sockets. Access-shaped changes re-check every socket. A periodic sweep covers
 * session revocation, which emits no domain event. Clients reconnect and re-authorise.
 */
import { EventBus } from "@audit/core/event-bus"
import {
  BoardChanged,
  DocChanged,
  MembersChanged,
  ProjectChanged,
  WorkspaceUpdated,
} from "@audit/domain/events"
import type { UserId } from "@audit/domain/ids"
import { Effect, Fiber, type ManagedRuntime, Schema, Stream } from "effect"
import type { CollabServices } from "./collab.ts"
import { Sessions } from "./sessions.ts"

/** Custom close code: the client should reconnect and re-authorise. */
export const CLOSE_ACCESS_CHANGED = 4403
const CLOSE_REASON = "access changed"
const SWEEP_MS = 60_000

/** Board and doc event kinds that can change who may see or edit the entity. */
const ACCESS_KINDS: Record<string, true> = {
  restricted: true,
  access_changed: true,
  moved: true,
  deleted: true,
}

export interface TrackedSocket {
  readonly userId: UserId
  readonly close: (code: number, reason: string) => void
  /** False when the session or access no longer allows the socket. Errors count as false. */
  readonly stillAllowed: () => Promise<boolean>
}

export interface SocketTracker {
  /** Registers a socket. The returned function untracks it. */
  readonly track: (socket: TrackedSocket) => () => void
  /** Subscribes to access events and starts the periodic sweep. Resolves once subscribed. */
  start(): Promise<void>
  stop(): Promise<void>
}

/** The session behind a request's headers, or `None` when it is absent or invalid. */
export const resolveSession = (
  runtime: ManagedRuntime.ManagedRuntime<CollabServices, unknown>,
  headers: Headers,
) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const sessions = yield* Sessions
      return yield* sessions.resolve(headers).pipe(Effect.option)
    }),
  )

const isAccessChange = (event: unknown): boolean =>
  Schema.is(ProjectChanged)(event) ||
  Schema.is(WorkspaceUpdated)(event) ||
  (Schema.is(BoardChanged)(event) && ACCESS_KINDS[event.kind] === true) ||
  (Schema.is(DocChanged)(event) && ACCESS_KINDS[event.kind] === true)

export const createSocketTracker = (
  runtime: ManagedRuntime.ManagedRuntime<CollabServices, unknown>,
  sweepMs = SWEEP_MS,
): SocketTracker => {
  const sockets = new Set<TrackedSocket>()
  let fiber: Fiber.Fiber<void, unknown> | undefined
  let sweeper: Timer | undefined

  const closeSocket = (socket: TrackedSocket) => {
    sockets.delete(socket)
    socket.close(CLOSE_ACCESS_CHANGED, CLOSE_REASON)
  }

  const closeUser = (userId: UserId) => {
    for (const socket of sockets) if (socket.userId === userId) closeSocket(socket)
  }

  const recheckAll = async () => {
    await Promise.all(
      [...sockets].map(async (socket) => {
        const allowed = await socket.stillAllowed().catch(() => false)
        if (!allowed && sockets.has(socket)) closeSocket(socket)
      }),
    )
  }

  const watch = (ready: PromiseWithResolvers<void>) =>
    Effect.gen(function* () {
      const bus = yield* EventBus
      const events = yield* bus.subscribe
      ready.resolve()
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.promise(async () => {
            if (Schema.is(MembersChanged)(event)) closeUser(event.userId)
            else if (isAccessChange(event)) await recheckAll()
          }),
        ),
      )
    }).pipe(Effect.scoped)

  return {
    track(socket) {
      sockets.add(socket)
      return () => {
        sockets.delete(socket)
      }
    },

    async start() {
      const ready = Promise.withResolvers<void>()
      fiber = runtime.runFork(watch(ready))
      await ready.promise
      sweeper = setInterval(() => void recheckAll(), sweepMs)
      sweeper.unref()
    },

    async stop() {
      clearInterval(sweeper)
      sweeper = undefined
      if (fiber !== undefined) await runtime.runPromise(Fiber.interrupt(fiber))
      fiber = undefined
      sockets.clear()
    },
  }
}
