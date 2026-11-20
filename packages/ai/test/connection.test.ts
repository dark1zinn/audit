import { expect, test } from "bun:test"
import { testConnection } from "@audit/ai/connection"
import { Effect, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"

const UPSTREAM_BODY = "upstream echo SECRET-ECHO-4242 with internal detail"

const failingHttp = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(UPSTREAM_BODY, { status: 401, headers: { "content-type": "text/plain" } }),
    ),
  ),
)

test("a failed connection test never echoes the provider's response body", async () => {
  const result = await Effect.runPromise(
    testConnection({
      kind: "openai_compatible",
      apiKey: Redacted.make("sk-test-CONNECTION-0001"),
      baseUrl: "https://93.184.216.34/v1",
      chatModel: "chat-test",
      embeddingModel: null,
      embeddingDimensions: null,
    }).pipe(Effect.provideService(HttpClient.HttpClient, failingHttp)),
  )
  expect(result.ok).toBe(false)
  expect(result.message).not.toContain("SECRET-ECHO")
  expect(result.message).not.toContain("internal detail")
})
