/**
 * Realtime co-editing for docs: a Hocuspocus instance on Bun's native WebSockets at `/collab`.
 *
 * Hocuspocus is driven through `handleConnection` on a thin socket adapter over `ServerWebSocket`
 * (not `Hocuspocus.Server`, which binds node:http). Documents are named `doc:<docId>`. Viewers and
 * commenters connect read-only; editors and managers read-write. Stores run `saveDocContent` as the
 * last editing user. Restores are pushed into live documents from the EventBus.
 */
import { Authz } from "@audit/core/authz"
import { EventBus } from "@audit/core/event-bus"
import { loadDocState, saveDocContent } from "@audit/core/docs/content"
import { CurrentActor, type UserActor, UserActor as UserActorSchema } from "@audit/domain/actor"
import { CHANGES_NOT_SAVED } from "@audit/domain/collab"
import { DocChanged } from "@audit/domain/events"
import type { DocId, UserId } from "@audit/domain/ids"
import { docs, projects } from "@audit/db/schema"
import { Secrets } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import {
  Hocuspocus,
  type onAuthenticatePayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
  type WebSocketLike,
} from "@hocuspocus/server"
import type { ServerWebSocket } from "bun"
import { eq } from "drizzle-orm"
import { Cause, Effect, Exit, Fiber, type ManagedRuntime, Schema, Stream } from "effect"
import type { SqlClient } from "effect/sql"
import * as Y from "yjs"
import { Sessions } from "./sessions.ts"
import { type SocketTracker, recheckSession, resolveSession } from "./socket-tracker.ts"

const DOC_NAME = /^doc:([0-9a-f-]{36})$/
/** Field name used by the Tiptap collaboration extension (see `@audit/editor/ydoc`). */
const FIELD = "default"

/** The part of Hocuspocus' ClientConnection used here (not exported by the package). */
interface SocketConnection {
  handleMessage(data: Uint8Array): void
  handleClose(event: { code: number; reason: string }): void
}

export interface CollabSocketData {
  readonly kind: "collab"
  readonly request: Request
  connection?: SocketConnection | undefined
  /** Access granted per doc at authentication. `true` means read-only. */
  readonly grants: Map<DocId, boolean>
  /** Set by `open`: lets the tracker close this socket. */
  ws?: ServerWebSocket<CollabSocketData> | undefined
  /** Removes this socket from the access sweep. Set once authenticated. */
  untrack?: (() => void) | undefined
  closed?: boolean
}

export type CollabServices = Authz | Db | EventBus | Secrets | Sessions | SqlClient.SqlClient

export interface CollabOptions {
  readonly runtime: ManagedRuntime.ManagedRuntime<CollabServices, unknown>
  readonly tracker: SocketTracker
  readonly debounce?: number
  readonly maxDebounce?: number
}

export interface Collab {
  /** Upgrades `/collab` websocket requests. Returns false for any other request. */
  handleUpgrade(request: Request, server: Bun.Server<unknown>): boolean
  readonly open: (ws: ServerWebSocket<CollabSocketData>) => void
  readonly message: (ws: ServerWebSocket<CollabSocketData>, message: string | Buffer) => void
  readonly close: (ws: ServerWebSocket<CollabSocketData>, code: number, reason: string) => void
  /** Subscribes to restore events. Resolves once the subscription is live. */
  start(): Promise<void>
  /** Closes sockets, flushes pending stores, waits for them to land. */
  shutdown(timeoutMs?: number): Promise<void>
  readonly documentsCount: () => number
  /** True while a session holds the doc in memory. */
  readonly isOpen: (docId: DocId) => boolean
}

/** Errors that mean this user's edits can never be saved, so retrying the store cannot help. */
const REFUSAL_TAGS: Record<string, true> = {
  Unauthorized: true,
  Forbidden: true,
  NotFound: true,
  ValidationError: true,
}
const isRefusal = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return false
  return typeof error._tag === "string" && REFUSAL_TAGS[error._tag] === true
}

const rejected = (reason: string): Error => Object.assign(new Error(reason), { reason })

/** The doc id in a `doc:<uuid>` document name. */
const docIdOf = (documentName: string): DocId => {
  const match = DOC_NAME.exec(documentName)
  if (!match) throw rejected("bad-document-name")
  return match[1] as DocId
}

/** The user who authenticated this connection; set by `onAuthenticate`. */
const actorOf = (context: unknown): UserActor => {
  const actor: unknown =
    typeof context === "object" && context !== null && "actor" in context
      ? context.actor
      : undefined
  if (Schema.is(UserActorSchema)(actor)) return actor
  throw rejected("unauthenticated")
}

/** Adapts one native socket to the surface Hocuspocus needs. */
const socketOf = (ws: ServerWebSocket<CollabSocketData>): WebSocketLike => ({
  get readyState() {
    return ws.readyState
  },
  send: (data) => {
    ws.send(data as string | Uint8Array)
  },
  close: (code, reason) => {
    ws.close(code, reason)
  },
})

/** What the user may do on a doc now. `null` when they may not see it. Archived projects are read-only. */
const docAccess = (userId: UserId, docId: DocId) =>
  Effect.gen(function* () {
    const authz = yield* Authz
    const role = yield* authz.roleOn(userId, docId)
    if (role === null) return null
    const db = yield* Db
    const [row] = yield* db
      .select({ status: projects.status })
      .from(docs)
      .leftJoin(projects, eq(projects.id, docs.projectId))
      .where(eq(docs.id, docId))
      .limit(1)
    const archived = row?.status === "archived"
    return { readOnly: archived || !(role === "editor" || role === "manager") }
  })

/** Replaces the live fragment with the restored state, so the change converges through Yjs. */
const replaceFragment = (live: Y.Doc, restored: Uint8Array) => {
  const fresh = new Y.Doc()
  Y.applyUpdate(fresh, restored)
  const target = live.getXmlFragment(FIELD)
  target.delete(0, target.length)
  target.insert(
    0,
    fresh
      .getXmlFragment(FIELD)
      .toArray()
      .flatMap((node) => (node instanceof Y.XmlHook ? [] : [node.clone()])),
  )
}

export const createCollab = (options: CollabOptions): Collab => {
  const { runtime, tracker } = options
  const pendingStores = new Set<Promise<void>>()
  // Documents whose latest store was refused. Hocuspocus keeps a document whose store failed, so
  // shutdown unloads these itself once they have no sockets left.
  const refusedDocs = new Set<DocId>()
  /** Every open collab socket, so the sockets of a doc whose edits were refused can be closed. */
  const sockets = new Set<CollabSocketData>()
  const socketsByRequest = new WeakMap<Request, CollabSocketData>()

  /** Re-checks a socket's session and every doc grant. Any mismatch means the socket must close. */
  const socketStillAllowed = async (socket: CollabSocketData) => {
    const session = await recheckSession(runtime, socket.request.headers)
    if (session._tag === "None" || session.value.twoFactorRequired) return false
    for (const [docId, readOnly] of socket.grants) {
      const access = await runtime.runPromise(docAccess(session.value.actor.userId, docId))
      if (access === null || access.readOnly !== readOnly) return false
    }
    return true
  }

  const hocuspocus = new Hocuspocus({
    debounce: options.debounce ?? 2_000,
    maxDebounce: options.maxDebounce ?? 10_000,

    async onAuthenticate(data: onAuthenticatePayload) {
      const docId = docIdOf(data.documentName)
      const session = await resolveSession(runtime, data.requestHeaders)
      if (session._tag === "None") throw rejected("unauthenticated")
      // Two-factor sessions are not complete until the second factor is verified.
      if (session.value.twoFactorRequired) throw rejected("two-factor-required")
      const { actor } = session.value

      const access = await runtime.runPromise(docAccess(actor.userId, docId))
      if (access === null) throw rejected("forbidden")
      // Viewers and commenters receive updates, but their Sync writes are discarded.
      data.connectionConfig.readOnly = access.readOnly

      const socket = socketsByRequest.get(data.request)
      if (socket !== undefined && socket.closed !== true) {
        socket.grants.set(docId, access.readOnly)
        socket.untrack ??= tracker.track({
          userId: actor.userId,
          close: (code, reason) => socket.ws?.close(code, reason),
          stillAllowed: () => socketStillAllowed(socket),
        })
      }
      return { actor }
    },

    async onLoadDocument(data: onLoadDocumentPayload) {
      const state = await runtime.runPromise(loadDocState(docIdOf(data.documentName)))
      // Returning a Uint8Array makes Hocuspocus apply it to the in-memory document.
      return state.ydoc ?? undefined
    },

    async onStoreDocument(data: onStoreDocumentPayload) {
      const docId = docIdOf(data.documentName)
      const actor = actorOf(data.lastContext)
      const state = Y.encodeStateAsUpdate(data.document)
      const store = runtime
        .runPromiseExit(
          Effect.provideService(
            saveDocContent.execute({ docId, ydocState: state }),
            CurrentActor,
            actor,
          ),
        )
        .then((exit) => {
          if (Exit.isSuccess(exit)) {
            refusedDocs.delete(docId)
            return
          }
          const error = Cause.squash(exit.cause)
          // Transient failures keep the document in memory so the next store retries it.
          if (!isRefusal(error)) throw error
          // These edits can never be saved for this user. Closing their sockets with a dedicated
          // code tells the client, and the document unloads once its last socket has closed.
          refusedDocs.add(docId)
          for (const socket of sockets) {
            if (socket.grants.has(docId)) socket.ws?.close(CHANGES_NOT_SAVED, "changes-not-saved")
          }
          throw new Error(`edits to ${docId} were refused and not saved`)
        })
      pendingStores.add(store)
      try {
        await store
      } finally {
        pendingStores.delete(store)
      }
    },
  })

  /** Pushes a restored doc into a live session. Unloaded docs load the restored state on connect. */
  const applyRestored = async (docId: DocId, actor: UserActor) => {
    const name = `doc:${docId}`
    if (!hocuspocus.documents.has(name)) return
    const state = await runtime.runPromise(loadDocState(docId))
    if (state.ydoc === null) return
    const restored = state.ydoc
    const connection = await hocuspocus.openDirectConnection(name, { actor })
    try {
      await connection.transact((live) => replaceFragment(live, restored))
    } finally {
      await connection.disconnect()
    }
  }

  const isRestored = (event: unknown): event is typeof DocChanged.Type =>
    Schema.is(DocChanged)(event) && (event.kind === "restored" || event.kind === "repaired")

  const watchRestores = (ready: PromiseWithResolvers<void>) =>
    Effect.gen(function* () {
      const bus = yield* EventBus
      const authz = yield* Authz
      const events = yield* bus.subscribe
      ready.resolve()
      yield* events.pipe(
        Stream.filter(isRestored),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const userId = event.actorId as UserId | null
            if (userId === null) return
            const role = yield* authz.workspaceRole(userId)
            if (role === null) return
            yield* Effect.promise(() => applyRestored(event.docId, { _tag: "user", userId, role }))
          }).pipe(
            Effect.catchCause((cause) => Effect.logError("collab restore sync failed", cause)),
          ),
        ),
      )
    }).pipe(Effect.scoped)

  let restoreFiber: Fiber.Fiber<void, unknown> | undefined

  return {
    handleUpgrade(request, server) {
      if (new URL(request.url).pathname !== "/collab") return false
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return false
      const data: CollabSocketData = { kind: "collab", request, grants: new Map() }
      socketsByRequest.set(request, data)
      return server.upgrade(request, { data })
    },

    open(ws) {
      ws.data.ws = ws
      sockets.add(ws.data)
      ws.data.connection = hocuspocus.handleConnection(
        socketOf(ws),
        ws.data.request,
      ) as SocketConnection
    },

    message(ws, data) {
      if (typeof data === "string") return
      ws.data.connection?.handleMessage(new Uint8Array(data))
    },

    close(ws, code, reason) {
      ws.data.closed = true
      sockets.delete(ws.data)
      ws.data.untrack?.()
      ws.data.untrack = undefined
      ws.data.connection?.handleClose({ code, reason })
      ws.data.connection = undefined
    },

    async start() {
      const ready = Promise.withResolvers<void>()
      restoreFiber = runtime.runFork(watchRestores(ready))
      await ready.promise
    },

    async shutdown(timeoutMs = 10_000) {
      if (restoreFiber !== undefined) {
        await runtime.runPromise(Fiber.interrupt(restoreFiber))
        restoreFiber = undefined
      }
      hocuspocus.closeConnections()
      hocuspocus.flushPendingStores()
      const deadline = Date.now() + timeoutMs
      while (hocuspocus.getDocumentsCount() > 0 || pendingStores.size > 0) {
        if (Date.now() > deadline) throw new Error("collab shutdown timed out")
        await Promise.allSettled(pendingStores)
        for (const docId of refusedDocs) {
          const document = hocuspocus.documents.get(`doc:${docId}`)
          if (document !== undefined) await hocuspocus.unloadDocument(document)
        }
        await Bun.sleep(25)
      }
    },

    documentsCount: () => hocuspocus.getDocumentsCount(),
    isOpen: (docId) => hocuspocus.documents.has(`doc:${docId}`),
  }
}
