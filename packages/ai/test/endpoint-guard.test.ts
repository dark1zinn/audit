import { expect, test } from "bun:test"
import { guardedHttp } from "@audit/ai/provider"
import { outboundHttp } from "@audit/platform/http"
import { Effect, Exit } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"

const PROVIDER = "https://api.example.test/v1/chat/completions"

/** An inner client that counts the requests that actually leave. */
const countingHttp = (counter: { count: number }) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      counter.count++
      return HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))
    }),
  )

test("a provider request is refused when its host now resolves to a private address", async () => {
  const counter = { count: 0 }
  const guarded = guardedHttp(countingHttp(counter), {
    allowPrivate: false,
    resolve: async () => ["10.0.0.5"],
  })
  const exit = await Effect.runPromise(
    Effect.exit(
      HttpClient.execute(HttpClientRequest.post(PROVIDER)).pipe(
        Effect.provideService(HttpClient.HttpClient, guarded),
      ),
    ),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  expect(counter.count).toBe(0)
})

test("a provider request to a host that resolves publicly is sent", async () => {
  const counter = { count: 0 }
  const guarded = guardedHttp(countingHttp(counter), {
    allowPrivate: false,
    resolve: async () => ["93.184.216.34"],
  })
  const exit = await Effect.runPromise(
    Effect.exit(
      HttpClient.execute(HttpClientRequest.post(PROVIDER)).pipe(
        Effect.provideService(HttpClient.HttpClient, guarded),
      ),
    ),
  )
  expect(Exit.isSuccess(exit)).toBe(true)
  expect(counter.count).toBe(1)
})

test("outbound HTTP does not follow a redirect to another host", async () => {
  let targetHits = 0
  const target = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      targetHits++
      return new Response("reached")
    },
  })
  const redirector = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(null, {
        status: 302,
        headers: { location: `http://127.0.0.1:${target.port}/` },
      }),
  })
  try {
    const exit = await Effect.runPromise(
      Effect.exit(
        HttpClient.get(`http://127.0.0.1:${redirector.port}/`).pipe(Effect.provide(outboundHttp)),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(targetHits).toBe(0)
  } finally {
    target.stop(true)
    redirector.stop(true)
  }
})
