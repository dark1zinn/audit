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
  socket?: ServerWebSocket<RpcSocketData>
}

/** Resolves the `fetch` promise for a request once its WebSocket upgrade happened. */
export const upgradeWaiters = new WeakMap<Request, () => void>()

export const withBunUpgrade = (
  request: HttpServerRequest.HttpServerRequest,
  server: Bun.Server<RpcSocketData>,
): HttpServerRequest.HttpServerRequest => {
  const upgrade = Effect.gen(function* () {
    const queue = yield* Queue.make<Uint8Array | string, Socket.SocketError>()
    const data: RpcSocketData = { kind: "rpc", queue }
    const source = request.source as Request
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
