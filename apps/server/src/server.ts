/**
 * The one process: `Bun.serve` routes by path, and every route ends in the same command layer.
 *
 *   /api/auth/*  → Better Auth
 *   /api/*       → Effect HttpApi
 *   /rpc         → Effect RPC over WebSocket
 *   /healthz, /readyz
 *   /*           → the built SPA
 */
import { join, normalize } from "node:path"
import { Authz } from "@audit/core/authz"
import { EventBus } from "@audit/core/event-bus"
import { CurrentActor } from "@audit/domain/actor"
import { RealtimeRpcs } from "@audit/domain/events"
import { RpcAuthentication } from "@audit/domain/http"
import { type AppConfigShape, AppConfig } from "@audit/platform/config"
import { BlobStore } from "@audit/platform/blob-store"
import { Secrets } from "@audit/platform/crypto"
import { APP_ROLE, databaseLayer, migrateDatabase } from "@audit/platform/database"
import { pgBossLayer } from "@audit/platform/jobs"
import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { SqlClient } from "effect/sql"
import { type AuthHandle, makeAuth } from "./auth.ts"
import { withClientIp } from "./client-ip.ts"
import { HttpApiLive } from "./http-api.ts"
import { jobDefinitions } from "./jobs.ts"
import { rateLimiterLayer } from "./rate-limit.ts"
import { Realtime, RealtimeRpcLive } from "./realtime.ts"
import { Sessions, sessionsLayer } from "./sessions.ts"
import { SetupToken } from "./setup-token.ts"
import { makeTrailWriter } from "./trail-writer.ts"
import {
  type RpcSocketData,
  rpcSocketHandlers,
  upgradeWaiters,
  withBunUpgrade,
} from "./websocket.ts"

class BunServer extends Context.Service<BunServer, Bun.Server<RpcSocketData>>()(
  "@audit/server/BunServer",
) {}

const securityHeaders: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}

const withHeaders = (response: Response) => {
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!response.headers.has(name)) response.headers.set(name, value)
  }
  return response
}

/** Infrastructure shared by every entry point; built once per process. */
export const makeCoreLayer = (config: AppConfigShape) => {
  const base = Layer.mergeAll(
    Layer.succeed(AppConfig, config),
    databaseLayer({ url: config.databaseUrl, role: APP_ROLE }),
  )
  const services = Layer.mergeAll(
    Authz.layer,
    EventBus.layer,
    BlobStore.layer,
    Secrets.layer,
    pgBossLayer({ url: config.databaseUrl, jobs: jobDefinitions }),
  )
  return services.pipe(Layer.provideMerge(base))
}

export interface RunningServer {
  readonly server: Bun.Server<RpcSocketData>
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
          return (yield* authz.workspaceRole(userId as never)) !== null
        }),
      ),
    trail: makeTrailWriter(runtime),
  })

  const serverLayer = Layer.mergeAll(
    sessionsLayer(auth),
    SetupToken.layer,
    rateLimiterLayer({ join: { max: 20, windowMs: 10 * 60_000 } }),
    Realtime.layer,
  ).pipe(Layer.provideMerge(core))

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

  const rpcLayer = RpcServer.layer(RealtimeRpcs).pipe(
    Layer.provide([RealtimeRpcLive, RpcAuthenticationLive]),
    Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/rpc" })),
    Layer.provide(RpcSerialization.layerJson),
  )

  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(HttpApiLive, rpcLayer).pipe(
      Layer.provide(serverLayer),
      Layer.provide(HttpServer.layerServices),
    ),
    {
      memoMap: runtime.memoMap,
      middleware: (effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const server = yield* BunServer
          return yield* Effect.provideService(
            effect,
            HttpServerRequest.HttpServerRequest,
            withBunUpgrade(request, server),
          )
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

  const server: Bun.Server<RpcSocketData> = Bun.serve<RpcSocketData>({
    port: config.port,
    async fetch(request, bunServer) {
      const url = new URL(request.url)
      const { pathname } = url
      const context = Context.make(BunServer, bunServer)
      if (pathname.startsWith("/api/auth/")) {
        return withHeaders(await auth.handler(withClientIp(request, bunServer, config.trustProxy)))
      }
      if (pathname === "/rpc") {
        const { promise: upgraded, resolve } = Promise.withResolvers<undefined>()
        upgradeWaiters.set(request, () => resolve(undefined))
        return Promise.race([app.handler(request, context), upgraded])
      }
      if (pathname.startsWith("/api/")) {
        const forwarded = withClientIp(request, bunServer, config.trustProxy)
        return withHeaders(await app.handler(forwarded, context))
      }
      if (pathname === "/healthz") return Response.json({ ok: true })
      if (pathname === "/readyz") {
        const ready = await runtime
          .runPromise(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              yield* sql`select 1`
            }),
          )
          .then(
            () => true,
            () => false,
          )
        return Response.json({ ok: ready }, { status: ready ? 200 : 503 })
      }
      return withHeaders(await serveStatic(pathname))
    },
    websocket: rpcSocketHandlers,
  })

  return {
    server,
    stop: async () => {
      await server.stop()
      await app.dispose()
      await runtime.dispose()
      await auth.close()
    },
  }
}
