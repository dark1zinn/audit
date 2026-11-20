/**
 * The server's outbound HTTP client. Fetch never follows redirects: a redirect could move a request
 * from an address we checked onto one we did not (a private host, say), so a 3xx is a failure.
 */
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpClient, filterStatus } from "effect/http/HttpClient"

const noRedirectFetch = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
)

export const outboundHttp = Layer.effect(
  HttpClient,
  Effect.gen(function* () {
    const http = yield* HttpClient
    return filterStatus(http, (status) => status < 300 || status >= 400)
  }),
).pipe(Layer.provide(noRedirectFetch))
