/**
 * Bridges Bun's native WebSockets to Effect sockets for the RPC server. The request is not served by
 * Effect's own Bun server, so `upgrade` goes through `server.upgrade` and a queue per socket.
 */
import type { ServerWebSocket } from "bun"
import { Cause, Effect, Queue } from "effect"
import { HttpServerError, type HttpServerRequest } from "effect/http"
import { Socket } from "effect/socket"

export interface RpcSocketData {
  readonly kind: "rpc"
  readonly queue: Queue.Queue<Uint8Array | string, Socket.SocketError>
  /** The upgrade request's headers, used to re-check the session. */
  readonly headers: Headers
  socket?: ServerWebSocket<RpcSocketData>
  /** Set once the socket is closed; stops late tracking. */
  closed?: boolean
  /** Removes this socket from the access sweep. Set once its session resolves. */
  untrack?: (() => void) | undefined
}

/** Resolves the `fetch` promise for a request once its WebSocket upgrade happened. */
export const upgradeWaiters = new WeakMap<Request, () => void>()

export const withBunUpgrade = (
  request: HttpServerRequest.HttpServerRequest,
  server: Pick<Bun.Server<RpcSocketData>, "upgrade">,
): HttpServerRequest.HttpServerRequest => {
  const upgrade = Effect.gen(function* () {
    const queue = yield* Queue.make<Uint8Array | string, Socket.SocketError>()
    const source = request.source as Request
    const data: RpcSocketData = { kind: "rpc", queue, headers: source.headers }
    if (!server.upgrade(source, { data })) {
      return yield* new HttpServerError.HttpServerError({
        reason: new HttpServerError.InternalError({
          request,
          description: "WebSocket upgrade refused",
        }),
      })
    }
    upgradeWaiters.get(source)?.()
    return Socket.make({
      reader: Effect.succeed({
        pull: Queue.takeAll(queue),
        upgrade: Socket.SocketUpgradeError.unsupported,
      }),
      writer: Effect.succeed({
        write: (chunk) =>
          Effect.sync(() => {
            if (chunk instanceof Socket.CloseEvent) data.socket?.close(chunk.code, chunk.reason)
            else data.socket?.send(chunk)
          }),
        writeAll: (chunks) =>
          Effect.sync(() => {
            for (const chunk of chunks) data.socket?.send(chunk)
          }),
      }),
    })
  })
  // `defineProperties` on a prototype-linked copy: assigning to the request throws.
  return Object.defineProperties(Object.create(request), {
    upgrade: { value: upgrade },
    upgradeWith: { value: () => upgrade },
  })
}

export const rpcSocketHandlers = {
  open(ws: ServerWebSocket<RpcSocketData>) {
    ws.data.socket = ws
  },
  message(ws: ServerWebSocket<RpcSocketData>, message: string | Buffer) {
    Queue.offerUnsafe(
      ws.data.queue,
      typeof message === "string" ? message : new Uint8Array(message),
    )
  },
  close(ws: ServerWebSocket<RpcSocketData>, code: number, reason: string) {
    Queue.failCauseUnsafe(
      ws.data.queue,
      Cause.fail(
        new Socket.SocketError({
          reason: new Socket.SocketCloseError({ code, closeReason: reason }),
        }),
      ),
    )
  },
}
