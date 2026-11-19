import type { DomainEvent, RealtimeMessage } from "@audit/domain/events"
import { RealtimeRpcs } from "@audit/domain/events"
import type { QueryClient } from "@tanstack/react-query"
import { Effect, Layer, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Socket } from "effect/socket"
import { keys } from "./queries.ts"

const MAX_BACKOFF_MS = 30_000

const socketUrl = () => {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws"
  return `${scheme}://${window.location.host}/rpc`
}

const SocketLive = Layer.effect(Socket.Socket, Socket.makeWebSocket(socketUrl())).pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
)

const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
  Layer.provide([RpcSerialization.layerJson, SocketLive]),
)

/** Which cached queries a domain event makes stale. */
export const invalidationsFor = (event: DomainEvent): ReadonlyArray<ReadonlyArray<string>> => {
  switch (event._tag) {
    case "MembersChanged":
      return [keys.members, keys.session]
    case "InvitesChanged":
      return [keys.invites]
    case "TeamsChanged":
      return [keys.teams]
    case "WorkspaceUpdated":
      return [keys.workspace, keys.session]
    case "ProfileUpdated":
      return [keys.session, keys.members]
  }
}

const applyMessage = (queryClient: QueryClient, message: RealtimeMessage) => {
  if (message._tag === "Resync") {
    void queryClient.invalidateQueries()
    return
  }
  for (const key of invalidationsFor(message.event)) {
    void queryClient.invalidateQueries({ queryKey: key })
  }
}

interface Resume {
  connectionId: string
  lastSeq: number
}

/**
 * Opens one realtime subscription and feeds each message into the query cache. Resolves when the
 * stream ends or fails; the caller decides whether to reconnect.
 */
const connectOnce = (
  queryClient: QueryClient,
  resume: Resume | undefined,
  onConnected: (connectionId: string) => void,
  onSeq: (seq: number) => void,
) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(RealtimeRpcs)
    yield* client["realtime.subscribe"]({
      scopes: ["workspace"],
      ...(resume === undefined ? {} : { resume }),
    }).pipe(
      Stream.runForEach((message) =>
        Effect.sync(() => {
          if (message._tag === "Hello") onConnected(message.connectionId)
          if (message._tag === "Event") onSeq(message.seq)
          if (message._tag !== "Hello") applyMessage(queryClient, message)
        }),
      ),
    )
  }).pipe(Effect.scoped, Effect.provide(ProtocolLive))

/**
 * Keeps a realtime subscription open while the app is mounted, reconnecting with capped
 * exponential backoff and resuming from the last sequence. Returns a stop function.
 */
export const startRealtime = (queryClient: QueryClient): (() => void) => {
  const controller = new AbortController()
  let resume: Resume | undefined
  let connectionId: string | undefined

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      controller.signal.addEventListener("abort", () => {
        clearTimeout(timer)
        resolve()
      })
    })

  const run = async () => {
    let attempt = 0
    while (!controller.signal.aborted) {
      try {
        await Effect.runPromise(
          connectOnce(
            queryClient,
            resume,
            (id) => {
              connectionId = id
              attempt = 0
            },
            (seq) => {
              if (connectionId !== undefined) resume = { connectionId, lastSeq: seq }
            },
          ),
          { signal: controller.signal },
        )
      } catch {
        // Fall through to the backoff below; the next attempt resumes or resyncs.
      }
      if (controller.signal.aborted) break
      attempt += 1
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5))
      await sleep(delay)
    }
  }

  void run()
  return () => controller.abort()
}
