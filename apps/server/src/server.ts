/**
 * The one process: `Bun.serve` routes by path, and every route ends in the same command layer.
 *
 *   /api/auth/*  → Better Auth
 *   /api/*       → Effect HttpApi
 *   /rpc         → Effect RPC over WebSocket
 *   /collab      → Hocuspocus co-editing over WebSocket
 *   /healthz, /readyz
 *   /*           → the built SPA
 */
import { join, normalize } from "node:path"
import { Authz } from "@audit/core/authz"
import { EventBus } from "@audit/core/event-bus"
import { liveAiModels } from "@audit/core/ai/models"
import { Mailer } from "@audit/core/notifications/mail"
import { assertPasswordAllowed, PasswordBreaches } from "@audit/core/admin/passwords"
import { LiveDocuments } from "@audit/core/docs/live-documents"
import { PushTransport } from "@audit/core/notifications/push"
import { vapidConfig } from "@audit/core/notifications/vapid"
import { sendResetPasswordEmail } from "@audit/core/notifications/account-mail"
import { CurrentActor } from "@audit/domain/actor"
import type { UserId } from "@audit/domain/ids"
import { RealtimeRpcs } from "@audit/domain/events"
import { RpcAuthentication } from "@audit/domain/http"
import { type AppConfigShape, AppConfig } from "@audit/platform/config"
import { BlobStore } from "@audit/platform/blob-store"
import { Secrets } from "@audit/platform/crypto"
import { APP_ROLE, databaseLayer, migrateDatabase, migrationStatus } from "@audit/platform/database"
import { pgBossLayer } from "@audit/platform/jobs"
import { Context, Effect, Layer, ManagedRuntime, Option, Redacted } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import type { ServerWebSocket } from "bun"
import { type AuthHandle, makeAuth } from "./auth.ts"
import { type CollabSocketData, createCollab } from "./collab.ts"
import { withClientIp } from "./client-ip.ts"
import {
  consoleContext,
  observabilityLayer,
  requestIdFrom,
  withRequestId,
} from "./observability.ts"
import { HttpApiLive } from "./http-api.ts"
import { FilesHttpLive } from "./files-http.ts"
import { IcalHttpLive } from "./ical-http.ts"
import { AiRpcs } from "@audit/domain/ai/rpc"
import { jobDefinitions, jobWorkersLayer } from "./jobs.ts"
import { Presence } from "./presence.ts"
import { rateLimiterLayer } from "./rate-limit.ts"
import { Realtime, RealtimeRpcLive } from "./realtime.ts"
import { AiRpcLive } from "./ai-rpc.ts"
import { Sessions, sessionsLayer } from "./sessions.ts"
import { SetupToken } from "./setup-token.ts"
import { makeTrailWriter } from "./trail-writer.ts"
import {
  type RpcSocketData,
  rpcSocketHandlers,
  upgradeWaiters,
  withBunUpgrade,
} from "./websocket.ts"

type SocketData = RpcSocketData | CollabSocketData

const isRpcSocket = (ws: ServerWebSocket<SocketData>): ws is ServerWebSocket<RpcSocketData> =>
  ws.data.kind === "rpc"

const isCollabSocket = (ws: ServerWebSocket<SocketData>): ws is ServerWebSocket<CollabSocketData> =>
  ws.data.kind === "collab"

class BunServer extends Context.Service<BunServer, Bun.Server<SocketData>>()(
  "@audit/server/BunServer",
) {}

const securityHeaders: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}

const withHeaders = (response: Response, requestId?: string) => {
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!response.headers.has(name)) response.headers.set(name, value)
  }
  if (requestId !== undefined) response.headers.set("x-request-id", requestId)
  return response
}

/** Web push always has keys (env or generated per workspace); email stays off until SMTP is set. */
const notificationTransports = (config: AppConfigShape) =>
  Layer.mergeAll(
    PushTransport.live(vapidConfig).pipe(Layer.provide(Secrets.layer)),
    Option.match(Option.all({ smtp: config.smtpUrl, from: config.mailFrom }), {
      onNone: () => Mailer.disabled,
      onSome: ({ smtp, from }) => Mailer.smtp(Redacted.value(smtp), from),
    }),
  )

/** Infrastructure shared by every entry point; built once per process. */
export const makeCoreLayer = (config: AppConfigShape) => {
  const base = Layer.mergeAll(
    Layer.succeed(AppConfig, config),
    databaseLayer({ url: config.databaseUrl, role: APP_ROLE }),
    observabilityLayer(config),
  )
  const services = Layer.mergeAll(
    Authz.layer,
    EventBus.layer,
    BlobStore.layer,
    PasswordBreaches.live,
    FetchHttpClient.layer,
    liveAiModels.pipe(Layer.provide(FetchHttpClient.layer)),
    Secrets.layer,
    notificationTransports(config),
    pgBossLayer({ url: config.databaseUrl, jobs: jobDefinitions }),
  )
  return services.pipe(Layer.provideMerge(base))
}

export interface RunningServer {
  readonly server: Bun.Server<SocketData>
  readonly stop: () => Promise<void>
}

export const startServer = async (config: AppConfigShape): Promise<RunningServer> => {
  await Effect.runPromise(migrateDatabase(config.databaseUrl))

  const core = makeCoreLayer(config)
  const runtime = ManagedRuntime.make(core)
  await runtime.runPromise(Effect.void)

  const auth: AuthHandle = makeAuth({
    config,
    canSignIn: (userId) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const authz = yield* Authz
          return (yield* authz.workspaceRole(userId as UserId)) !== null
        }),
      ),
    checkPassword: (password) =>
      runtime.runPromise(
        assertPasswordAllowed(password).pipe(
          Effect.as<string | null>(null),
          Effect.catch((error) => Effect.succeed(error.message)),
        ),
      ),
    trail: makeTrailWriter(runtime),
    sendResetPassword: (input) => runtime.runPromise(sendResetPasswordEmail(input)),
  })

  const sessions = sessionsLayer(auth)

  // Shares the memo map so Db, Authz and EventBus are the same instances as in `runtime`.
  const collabRuntime = ManagedRuntime.make(sessions.pipe(Layer.provideMerge(core)), {
    memoMap: runtime.memoMap,
  })
  const collab = createCollab({ runtime: collabRuntime })

  // Compaction reads the collaboration server's open docs; the jobs see them through the layer.
  const liveDocuments = Layer.succeed(LiveDocuments, { isOpen: (docId) => collab.isOpen(docId) })

  const serverLayer = Layer.mergeAll(
    sessions,
    SetupToken.layer,
    rateLimiterLayer({
      join: { max: 20, windowMs: 10 * 60_000 },
      signup: { max: 10, windowMs: 60 * 60_000 },
    }),
    Presence.layer,
    Realtime.layer,
    jobWorkersLayer,
  ).pipe(Layer.provideMerge(liveDocuments), Layer.provideMerge(core))
  await collab.start()

  const RpcAuthenticationLive = Layer.effect(
    RpcAuthentication,
    Effect.gen(function* () {
      const sessions = yield* Sessions
      // The cookie travels on the WebSocket upgrade; its headers are merged into every RPC request.
      return RpcAuthentication.of((effect, { headers }) =>
        Effect.gen(function* () {
          const resolved = yield* sessions.resolve(new Headers(headers as Record<string, string>))
          return yield* Effect.provideService(effect, CurrentActor, resolved.actor)
        }),
      )
    }),
  )

  const rpcLayer = RpcServer.layer(RealtimeRpcs.merge(AiRpcs)).pipe(
    Layer.provide([RealtimeRpcLive, AiRpcLive, RpcAuthenticationLive]),
    Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/rpc" })),
    Layer.provide(RpcSerialization.layerJson),
  )

  const loggerContext = consoleContext(config)
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(HttpApiLive, rpcLayer, FilesHttpLive, IcalHttpLive).pipe(
      Layer.provide(serverLayer),
      Layer.provide(HttpServer.layerServices),
    ),
    {
      memoMap: runtime.memoMap,
      middleware: (effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const server = yield* BunServer
          const requestId = requestIdFrom(request.headers["x-request-id"] ?? null)
          return yield* Effect.provideService(
            effect,
            HttpServerRequest.HttpServerRequest,
            withBunUpgrade(request, server),
          ).pipe(Effect.annotateLogs({ requestId }))
        }),
    },
  )

  const webRoot = normalize(config.webDist)
  const serveStatic = async (pathname: string) => {
    const path = normalize(join(webRoot, decodeURIComponent(pathname)))
    if (path.startsWith(webRoot)) {
      const file = Bun.file(path)
      if (pathname !== "/" && (await file.exists())) {
        const immutable = pathname.startsWith("/assets/")
        return new Response(file, {
          headers: immutable ? { "cache-control": "public, max-age=31536000, immutable" } : {},
        })
      }
    }
    const index = Bun.file(join(webRoot, "index.html"))
    if (await index.exists())
      return new Response(index, { headers: { "cache-control": "no-cache" } })
    return new Response("The web app is not built. Run `bun run build:web`.", { status: 404 })
  }

  const server: Bun.Server<SocketData> = Bun.serve<SocketData>({
    port: config.port,
    async fetch(incoming, bunServer) {
      const requestId = requestIdFrom(incoming.headers.get("x-request-id"))
      const { pathname } = new URL(incoming.url)
      // Upgrades need the original Request object; plain HTTP paths carry the id forward.
      const request =
        pathname === "/collab" || pathname === "/rpc"
          ? incoming
          : withRequestId(incoming, requestId)
      const context = Context.add(loggerContext, BunServer, bunServer) as Context.Context<unknown>
      if (pathname.startsWith("/api/auth/")) {
        const forwarded = withClientIp(request, bunServer, config.trustProxy)
        return withHeaders(await auth.handler(forwarded), requestId)
      }
      if (pathname === "/collab") {
        if (collab.handleUpgrade(request, bunServer)) return undefined
        return new Response("Unauthorized", { status: 401 })
      }
      if (pathname === "/rpc") {
        const { promise: upgraded, resolve } = Promise.withResolvers<undefined>()
        upgradeWaiters.set(request, () => resolve(undefined))
        return Promise.race([app.handler(request, context), upgraded])
      }
      if (pathname.startsWith("/api/")) {
        const forwarded = withClientIp(request, bunServer, config.trustProxy)
        return withHeaders(await app.handler(forwarded, context), requestId)
      }
      if (pathname.startsWith("/files/") || pathname.startsWith("/ical/")) {
        const forwarded = withClientIp(request, bunServer, config.trustProxy)
        return withHeaders(await app.handler(forwarded, context), requestId)
      }
      if (pathname === "/healthz") return Response.json({ ok: true })
      if (pathname === "/readyz") {
        const ready = await runtime.runPromise(migrationStatus).then(
          (status) => status.ready,
          () => false,
        )
        return Response.json({ ok: ready }, { status: ready ? 200 : 503 })
      }
      return withHeaders(await serveStatic(pathname))
    },
    websocket: {
      open(ws) {
        if (isCollabSocket(ws)) collab.open(ws)
        else if (isRpcSocket(ws)) rpcSocketHandlers.open(ws)
      },
      message(ws, message) {
        if (isCollabSocket(ws)) collab.message(ws, message)
        else if (isRpcSocket(ws)) rpcSocketHandlers.message(ws, message)
      },
      close(ws, code, reason) {
        if (isCollabSocket(ws)) collab.close(ws, code, reason)
        else if (isRpcSocket(ws)) rpcSocketHandlers.close(ws, code, reason)
      },
    },
  })

  return {
    server,
    stop: async () => {
      // Stop accepting new connections; in-flight requests finish.
      await server.stop(false)
      // Collab stores must land while the runtime that runs them is still alive.
      await collab.shutdown()
      // Then drop what remains (open RPC sockets) before the services underneath go away.
      await server.stop(true)
      await app.dispose()
      await collabRuntime.dispose()
      await runtime.dispose()
      await auth.close()
    },
  }
}
