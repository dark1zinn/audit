import { afterEach, describe, expect, test } from "bun:test"
import { EventBus } from "@audit/core/event-bus"
import type { DomainEvent } from "@audit/domain/events"
import type { UserId } from "@audit/domain/ids"
import { Effect, ManagedRuntime } from "effect"
import type { CollabServices } from "../src/collab.ts"
import {
  CLOSE_ACCESS_CHANGED,
  createSocketTracker,
  type SocketTracker,
  type TrackedSocket,
} from "../src/socket-tracker.ts"

// The tracker only uses the event bus, so the runtime is built from the bus layer alone.
const runtime = ManagedRuntime.make(EventBus.layer) as unknown as ManagedRuntime.ManagedRuntime<
  CollabServices,
  unknown
>

const USER_A = "00000000-0000-4000-8000-00000000000a" as UserId
const USER_B = "00000000-0000-4000-8000-00000000000b" as UserId
const USER_C = "00000000-0000-4000-8000-00000000000c" as UserId
const USER_D = "00000000-0000-4000-8000-00000000000d" as UserId

const trackers: SocketTracker[] = []

afterEach(async () => {
  for (const tracker of trackers.splice(0)) await tracker.stop()
})

const startTracker = async (sweepMs?: number) => {
  const tracker = createSocketTracker(runtime, sweepMs)
  trackers.push(tracker)
  await tracker.start()
  return tracker
}

const fakeSocket = (userId: UserId, stillAllowed: () => Promise<boolean>) => {
  const closes: Array<{ code: number; reason: string }> = []
  const socket: TrackedSocket = {
    userId,
    close: (code, reason) => {
      closes.push({ code, reason })
    },
    stillAllowed,
  }
  return { socket, closes }
}

const publish = (event: DomainEvent) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus
      yield* bus.publish([event])
    }),
  )

const membersChanged = (userId: UserId): DomainEvent => ({
  _tag: "MembersChanged",
  entityId: null,
  projectId: null,
  actorId: null,
  version: null,
  userId,
})

const workspaceUpdated: DomainEvent = {
  _tag: "WorkspaceUpdated",
  entityId: null,
  projectId: null,
  actorId: null,
  version: null,
}

/**
 * Event delivery runs on the bus's fiber and the tracker exposes no completion signal, so the test
 * polls for the observable effect (the close call). The sweep test relies on real interval timing.
 */
const eventually = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await Bun.sleep(5)
}

describe("socket tracker", () => {
  test("a membership change closes that user's sockets and no others", async () => {
    const tracker = await startTracker()
    const changed = fakeSocket(USER_A, async () => true)
    const other = fakeSocket(USER_B, async () => true)
    tracker.track(changed.socket)
    tracker.track(other.socket)

    await publish(membersChanged(USER_A))
    await eventually(() => changed.closes.length > 0)

    expect(changed.closes).toEqual([{ code: CLOSE_ACCESS_CHANGED, reason: "access changed" }])
    expect(other.closes).toEqual([])
  })

  test("an access event re-checks every socket and closes only the disallowed ones", async () => {
    const tracker = await startTracker()
    const allowed = fakeSocket(USER_A, async () => true)
    const revoked = fakeSocket(USER_B, async () => false)
    const failing = fakeSocket(USER_C, async () => {
      throw new Error("session lookup failed")
    })
    tracker.track(allowed.socket)
    tracker.track(revoked.socket)
    tracker.track(failing.socket)

    await publish(workspaceUpdated)
    await eventually(() => revoked.closes.length > 0 && failing.closes.length > 0)

    expect(revoked.closes).toHaveLength(1)
    expect(failing.closes).toHaveLength(1)
    expect(allowed.closes).toEqual([])
  })

  test("an untracked socket is not closed by a later membership change", async () => {
    const tracker = await startTracker()
    const untracked = fakeSocket(USER_A, async () => true)
    const trailing = fakeSocket(USER_D, async () => true)
    const untrack = tracker.track(untracked.socket)
    tracker.track(trailing.socket)
    untrack()

    await publish(membersChanged(USER_A))
    await publish(membersChanged(USER_D))
    await eventually(() => trailing.closes.length > 0)

    expect(trailing.closes).toHaveLength(1)
    expect(untracked.closes).toEqual([])
  })

  test("the periodic sweep closes a socket whose session has ended", async () => {
    const tracker = await startTracker(10)
    const ended = fakeSocket(USER_A, async () => false)
    tracker.track(ended.socket)

    await eventually(() => ended.closes.length > 0)

    expect(ended.closes).toEqual([{ code: CLOSE_ACCESS_CHANGED, reason: "access changed" }])
  })
})
