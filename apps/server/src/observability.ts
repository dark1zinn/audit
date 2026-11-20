/**
 * Logging and telemetry, shared by every entry point.
 *
 *   LOG_LEVEL   minimum level (default "info"; all, trace, debug, info, warn, error, fatal, none)
 *   LOG_FORMAT  "json" | "pretty" (default: json when NODE_ENV=production, else pretty)
 *   OTEL_EXPORTER_OTLP_ENDPOINT  when set, logs, metrics and traces are also exported over OTLP/HTTP
 *   AUDIT_VERSION  reported as the OpenTelemetry service version
 */
import { Config, Context, Effect, Layer, Logger, LogLevel, Option, References } from "effect"
import { FetchHttpClient } from "effect/http"
import * as Otlp from "effect/observability/Otlp"
import type { AppConfigShape } from "@audit/platform/config"

const LEVELS: Record<string, LogLevel.LogLevel> = {
  all: "All",
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
  none: "None",
}

export const parseLogLevel = (value: string): LogLevel.LogLevel => {
  const level = LEVELS[value.trim().toLowerCase()]
  if (level === undefined) {
    throw new Error(`LOG_LEVEL must be one of ${Object.keys(LEVELS).join(", ")}; got "${value}"`)
  }
  return level
}

/** Read at startup from the environment, not inlined by the bundler at build time. */
const resolveFormat = Effect.gen(function* () {
  const configured = yield* Config.Literals(["json", "pretty"], "LOG_FORMAT").pipe(Config.option)
  const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"))
  return Option.getOrElse(configured, (): "json" | "pretty" =>
    nodeEnv === "production" ? "json" : "pretty",
  )
})

const logger = Effect.map(resolveFormat, (format) =>
  format === "json" ? Logger.consoleJson : Logger.consolePretty(),
)

/** Console logging at the configured level; JSON lines in production. */
export const loggingLayer = (config: AppConfigShape) =>
  Layer.unwrap(
    Effect.gen(function* () {
      return Layer.mergeAll(
        Logger.layer([yield* logger]),
        Layer.succeed(References.MinimumLogLevel, parseLogLevel(config.logLevel)),
      )
    }),
  )

/**
 * The same console logger as a context for web handlers. Loggers set by a layer do not reach
 * request fibers that `HttpRouter.toWebHandler` creates, so each handler call carries them.
 */
export const consoleContext = (config: AppConfigShape): Context.Context<never> =>
  Context.make(Logger.CurrentLoggers, new Set([Effect.runSync(logger)])).pipe(
    Context.add(References.MinimumLogLevel, parseLogLevel(config.logLevel)),
  ) as Context.Context<never>

/** OTLP export of logs, metrics and traces when an endpoint is configured; console logging stays on. */
export const otelLayer = (config: AppConfigShape) =>
  Option.match(config.otelEndpoint, {
    onNone: () => Layer.empty,
    onSome: (baseUrl) =>
      Otlp.layerJson({
        baseUrl,
        resource: { serviceName: "audit", serviceVersion: process.env.AUDIT_VERSION ?? "0.0.0" },
        loggerMergeWithExisting: true,
      }).pipe(Layer.provide(FetchHttpClient.layer)),
  })

/** Every telemetry layer the runtime needs, built once per process. */
export const observabilityLayer = (config: AppConfigShape) =>
  Layer.mergeAll(loggingLayer(config), otelLayer(config))

/** Accepts the caller's `x-request-id` when it is a sane token; otherwise mints one. */
export const requestIdFrom = (header: string | null): string =>
  header !== null && /^[A-Za-z0-9._-]{1,128}$/.test(header) ? header : crypto.randomUUID()

export const withRequestId = (request: Request, requestId: string): Request => {
  const headers = new Headers(request.headers)
  headers.set("x-request-id", requestId)
  return new Request(request, { headers })
}
