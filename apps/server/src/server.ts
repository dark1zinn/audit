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
import { loadTrailKey } from "@audit/core/trail-key"
import { trailChainer } from "@audit/core/trail-chain"
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
import { Unauthorized } from "@audit/domain/errors"
import { type AppConfigShape, AppConfig } from "@audit/platform/config"
import { BlobStore } from "@audit/platform/blob-store"
import { Secrets } from "@audit/platform/crypto"
import { APP_ROLE, databaseLayer, migrateDatabase, migrationStatus } from "@audit/platform/database"
import { pgBossLayer } from "@audit/platform/jobs"
import { outboundHttp } from "@audit/platform/http"
import { Context, Effect, Fiber, Layer, ManagedRuntime, Option, Redacted } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import type { ServerWebSocket } from "bun"
import { type AuthHandle, makeAuth } from "./auth.ts"
import { type CollabSocketData, createCollab } from "./collab.ts"
import { withClientIp } from "./client-ip.ts"
import { isSameOriginRequest, needsOriginCheck } from "./origin.ts"
import { resolveStaticPath } from "./static-path.ts"
import { createSocketTracker, recheckSession, resolveSession } from "./socket-tracker.ts"
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
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
}

const withHeaders = (response: Response, requestId?: string, noStore = false) => {
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!response.headers.has(name)) response.headers.set(name, value)
  }
  if (requestId !== undefined) response.headers.set("x-request-id", requestId)
  if (noStore && !response.headers.has("cache-control")) {
    response.headers.set("cache-control", "no-store")
  }
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
    outboundHttp,
    liveAiModels.pipe(Layer.provide(outboundHttp)),
    Secrets.layer,
    notificationTransports(config),
    pgBossLayer({
      url: config.databaseUrl,
      setupUrl: config.databaseMigratorUrl,
      jobs: jobDefinitions,
    }),
  )
  return services.pipe(Layer.provideMerge(base))
}
/** Database and secrets only: enough to chain the trail without starting the job runner. */
export const makeTrailLayer = (config: AppConfigShape) =>
  Layer.mergeAll(databaseLayer({ url: config.databaseUrl, role: APP_ROLE }), Secrets.layer).pipe(
    Layer.provide(Layer.succeed(AppConfig, config)),
  )

export interface RunningServer {
  readonly server: Bun.Server<SocketData>
  readonly stop: () => Promise<void>
}

export const startServer = async (config: AppConfigShape): Promise<RunningServer> => {
  await Effect.runPromise(migrateDatabase(config.databaseMigratorUrl))

  const core = makeCoreLayer(config)
  const runtime = ManagedRuntime.make(core)
  // Refuse to start under a secret that cannot open the trail key: every audit write needs it.
  await runtime.runPromise(loadTrailKey)
  // Chains the audit trail as commands commit; stopped with the server, before the runtime goes.
  const chainer = runtime.runFork(Effect.scoped(trailChainer))

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
  const tracker = createSocketTracker(collabRuntime)
  const collab = createCollab({ runtime: collabRuntime, tracker })

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
  await tracker.start()

  const RpcAuthenticationLive = Layer.effect(
    RpcAuthentication,
    Effect.gen(function* () {
      const sessions = yield* Sessions
      // The cookie travels on the WebSocket upgrade; its headers are merged into every RPC request.
      return RpcAuthentication.of((effect, { headers }) =>
        Effect.gen(function* () {
          const resolved = yield* sessions.resolve(new Headers(headers as Record<string, string>))
          // A session still waiting on its second factor is not authenticated for RPC.
          if (resolved.twoFactorRequired) {
            return yield* new Unauthorized({ message: "Two-factor authentication required" })
          }
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
  const serveStatic = async (pathname: string): Promise<Response> => {
    const resolved = resolveStaticPath(webRoot, pathname)
    if (resolved.kind === "malformed") return new Response("Bad request", { status: 400 })
    if (resolved.kind === "file" && pathname !== "/") {
      const file = Bun.file(resolved.path)
      if (await file.exists()) {
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

  /** Tracks an RPC socket for the access sweep once its session resolves. */
  const trackRpc = async (ws: ServerWebSocket<RpcSocketData>) => {
    const session = await resolveSession(collabRuntime, ws.data.headers)
    if (session._tag === "None" || ws.data.closed === true) return
    ws.data.untrack = tracker.track({
      userId: session.value.actor.userId,
      close: (code, reason) => ws.close(code, reason),
      stillAllowed: async () => {
        const current = await recheckSession(collabRuntime, ws.data.headers)
        return current._tag === "Some" && !current.value.twoFactorRequired
      },
    })
  }

  const server: Bun.Server<SocketData> = Bun.serve<SocketData>({
    port: config.port,
    // Seconds an idle keep-alive connection stays open. Longer than common reverse-proxy upstream
    // idle timeouts (Traefik 90 s, nginx 60 s), so the proxy closes first; if the app closed first,
    // a request racing the close would fail (a POST becomes a 502 at the proxy).
    idleTimeout: 120,
    async fetch(incoming, bunServer) {
      const requestId = requestIdFrom(incoming.headers.get("x-request-id"))
      const { pathname } = new URL(incoming.url)
      if (needsOriginCheck(incoming) && !isSameOriginRequest(incoming, config.url.origin)) {
        return withHeaders(new Response("Forbidden", { status: 403 }), requestId)
      }
      // Upgrades need the original Request object; plain HTTP paths carry the id forward.
      const request =
        pathname === "/collab" || pathname === "/rpc"
          ? incoming
          : withRequestId(incoming, requestId)
      const context = Context.add(loggerContext, BunServer, bunServer) as Context.Context<unknown>
      if (pathname.startsWith("/api/auth/")) {
        const forwarded = withClientIp(request, bunServer, config.trustProxy, config.trustProxyHops)
        return withHeaders(await auth.handler(forwarded), requestId, true)
      }
      if (pathname === "/collab") {
        if (collab.handleUpgrade(request, bunServer)) return undefined
        return withHeaders(new Response("Unauthorized", { status: 401 }), requestId)
      }
      if (pathname === "/rpc") {
        const { promise: upgraded, resolve } = Promise.withResolvers<undefined>()
        upgradeWaiters.set(request, () => resolve(undefined))
        const response = await Promise.race([app.handler(request, context), upgraded])
        return response === undefined ? undefined : withHeaders(response, requestId)
      }
      if (pathname.startsWith("/api/")) {
        const forwarded = withClientIp(request, bunServer, config.trustProxy, config.trustProxyHops)
        return withHeaders(await app.handler(forwarded, context), requestId, true)
      }
      if (pathname.startsWith("/files/") || pathname.startsWith("/ical/")) {
        const forwarded = withClientIp(request, bunServer, config.trustProxy, config.trustProxyHops)
        return withHeaders(await app.handler(forwarded, context), requestId)
      }
      if (pathname === "/healthz") return withHeaders(Response.json({ ok: true }), requestId)
      if (pathname === "/readyz") {
        const ready = await runtime.runPromise(migrationStatus).then(
          (status) => status.ready,
          () => false,
        )
        return withHeaders(Response.json({ ok: ready }, { status: ready ? 200 : 503 }), requestId)
      }
      return withHeaders(await serveStatic(pathname), requestId)
    },
    websocket: {
      open(ws) {
        if (isCollabSocket(ws)) collab.open(ws)
        else if (isRpcSocket(ws)) {
          rpcSocketHandlers.open(ws)
          void trackRpc(ws)
        }
      },
      message(ws, message) {
        if (isCollabSocket(ws)) collab.message(ws, message)
        else if (isRpcSocket(ws)) rpcSocketHandlers.message(ws, message)
      },
      close(ws, code, reason) {
        if (isCollabSocket(ws)) collab.close(ws, code, reason)
        else if (isRpcSocket(ws)) {
          ws.data.closed = true
          ws.data.untrack?.()
          rpcSocketHandlers.close(ws, code, reason)
        }
      },
    },
  })

  return {
    server,
    stop: async () => {
      // In order: stop accepting connections (in-flight requests finish); land collab stores while
      // their runtime is alive; then drop what remains (open RPC sockets) before the services
      // underneath go away. A failing step must not skip the rest, so the first error is rethrown
      // only after every step ran.
      const steps: ReadonlyArray<() => Promise<unknown>> = [
        () => server.stop(false),
        () => collab.shutdown(),
        () => tracker.stop(),
        () => server.stop(true),
        () => app.dispose(),
        () => collabRuntime.dispose(),
        () => runtime.runPromise(Fiber.interrupt(chainer)),
        () => runtime.dispose(),
        () => auth.close(),
      ]
      let failure: { readonly error: unknown } | undefined
      for (const step of steps) {
        try {
          await step()
        } catch (error) {
          failure ??= { error }
        }
      }
      if (failure !== undefined) throw failure.error
    },
  }
}
