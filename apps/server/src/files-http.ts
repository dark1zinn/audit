/**
 * File routes. Uploads are multipart, which HttpApi does not carry, so they are plain router
 * routes. Every route resolves the session, then calls a command or query, as `http-api.ts` does.
 */
import type { Authz } from "@audit/core/authz"
import type { EventBus } from "@audit/core/event-bus"
import { uploadFile } from "@audit/core/files/commands"
import * as adminCommands from "@audit/core/admin/commands"
import { isInlineMime } from "@audit/core/files/media"
import { fileLimits, openFile, type OpenedFile } from "@audit/core/files/queries"
import { RequestMeta } from "@audit/core/request"
import { CurrentActor } from "@audit/domain/actor"
import {
  Conflict,
  Forbidden,
  NotFound,
  RateLimited,
  Unauthorized,
  ValidationError,
} from "@audit/domain/errors"
import { EntityId, FileId } from "@audit/domain/ids"
import { BlobStore } from "@audit/platform/blob-store"
import type { AppConfig } from "@audit/platform/config"
import type { Db } from "@audit/platform/database"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import type { SqlClient } from "effect/sql"
import { clientMeta } from "./http-api.ts"
import { Sessions, type SessionsShape } from "./sessions.ts"

/** Allowance for multipart framing on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

type RouteError = Conflict | Forbidden | NotFound | RateLimited | Unauthorized | ValidationError

/** Services the commands and queries need, captured once when the layer is built. */
type FilesRequirements = Db | SqlClient.SqlClient | Authz | EventBus | AppConfig | BlobStore

/** Captured at layer build, as `http-api.ts` does, because request context lacks these. */
interface RouteDeps {
  readonly sessions: SessionsShape
  readonly core: Context.Context<FilesRequirements>
}

const statusByTag: Record<string, number> = {
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  ValidationError: 422,
  RateLimited: 429,
}

/**
 * Runs one route: resolves the session, provides the actor and client metadata, and maps domain
 * errors to JSON responses with their status.
 */
const route = <E extends RouteError, R>(
  deps: RouteDeps,
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const resolved = yield* deps.sessions.resolve(
      new Headers(request.headers as Record<string, string>),
    )
    if (resolved.twoFactorRequired) {
      return yield* new Unauthorized({ message: "two_factor_required" })
    }
    const meta = yield* clientMeta
    return yield* Effect.provideService(
      Effect.provideService(effect.pipe(Effect.provide(deps.core)), CurrentActor, resolved.actor),
      RequestMeta,
      meta,
    )
  }).pipe(
    Effect.catch((error: RouteError) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { _tag: error._tag, message: error.message },
          { status: statusByTag[error._tag] ?? 500 },
        ),
      ),
    ),
  )

const fileResponse = (opened: OpenedFile, variant: "original" | "thumbnail") => {
  const inline = variant === "thumbnail" || isInlineMime(opened.mime)
  const fallback = opened.name.replace(/[^\x20-\x7e]|["\\]/g, "_")
  const disposition = [
    inline ? "inline" : "attachment",
    `filename="${fallback}"`,
    `filename*=UTF-8''${encodeURIComponent(opened.name)}`,
  ].join("; ")
  return HttpServerResponse.fromWeb(
    new Response(opened.body, {
      headers: {
        "content-type": opened.mime,
        "content-disposition": disposition,
        "content-security-policy": "sandbox; default-src 'none'",
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      },
    }),
  )
}

const uploadRoute = (deps: RouteDeps) =>
  route(
    deps,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const limits = yield* fileLimits
      const declared = Number(request.headers["content-length"] ?? 0)
      if (declared > limits.uploadLimitBytes + MULTIPART_OVERHEAD_BYTES) {
        return yield* new ValidationError({
          message: "The file is larger than the upload limit",
          field: "file",
        })
      }
      const form = yield* Effect.tryPromise({
        try: () => (request.source as Request).formData(),
        catch: () => new ValidationError({ message: "Expected a multipart form", field: "body" }),
      })
      const file = form.get("file")
      if (!(file instanceof File)) {
        return yield* new ValidationError({ message: "Missing file", field: "file" })
      }
      const parentRaw = form.get("parentId")
      const parentId = Schema.is(EntityId)(parentRaw) ? parentRaw : null
      if (parentId === null) {
        return yield* new ValidationError({
          message: "Missing or invalid parentId",
          field: "parentId",
        })
      }
      const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()))
      const ref = yield* uploadFile.execute({ parentId, name: file.name, bytes })
      return HttpServerResponse.jsonUnsafe(ref, { status: 201 })
    }),
  )

const logoRoute = (deps: RouteDeps) =>
  route(
    deps,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const declared = Number(request.headers["content-length"] ?? 0)
      if (declared > adminCommands.LOGO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
        return yield* new ValidationError({
          message: "The logo is larger than 2 MB",
          field: "file",
        })
      }
      const form = yield* Effect.tryPromise({
        try: () => (request.source as Request).formData(),
        catch: () => new ValidationError({ message: "Expected a multipart form", field: "body" }),
      })
      const file = form.get("file")
      if (!(file instanceof File)) {
        return yield* new ValidationError({ message: "Missing file", field: "file" })
      }
      const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()))
      const ref = yield* adminCommands.uploadLogo.execute({ name: file.name, bytes })
      return HttpServerResponse.jsonUnsafe(ref, { status: 200 })
    }),
  )

const downloadRoute = (deps: RouteDeps, variant: "original" | "thumbnail") =>
  route(
    deps,
    Effect.gen(function* () {
      const params = yield* HttpRouter.params
      const parsed = Schema.decodeUnknownOption(FileId)(params["id"])
      if (parsed._tag === "None") {
        return yield* new NotFound({ entity: "file", id: params["id"] ?? "" })
      }
      const opened = yield* openFile(parsed.value, variant)
      return fileResponse(opened, variant)
    }),
  )

/** Streams the workspace export; `Content-Length` is unknown, so the body is chunked. */
const exportRoute = (deps: RouteDeps) =>
  route(
    deps,
    Effect.gen(function* () {
      yield* adminCommands.exportWorkspace.execute({})
      const body = yield* adminCommands.workspaceExport
      return HttpServerResponse.stream(body, {
        contentType: "application/x-ndjson",
        headers: {
          "content-disposition": 'attachment; filename="workspace-export.jsonl"',
          "cache-control": "no-store",
        },
      })
    }),
  )

/** Upload and download routes; provided next to `HttpApiLive` in `server.ts`. */
export const FilesHttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const core = yield* Effect.context<FilesRequirements>()
    const deps: RouteDeps = { sessions, core }
    return Layer.mergeAll(
      HttpRouter.add("POST", "/api/files", uploadRoute(deps)),
      HttpRouter.add("POST", "/api/admin/branding/logo", logoRoute(deps)),
      HttpRouter.add("POST", "/api/admin/export", exportRoute(deps)),
      HttpRouter.add("GET", "/files/:id", downloadRoute(deps, "original")),
      HttpRouter.add("GET", "/files/:id/thumb", downloadRoute(deps, "thumbnail")),
    )
  }),
)
