import { afterEach, describe, expect, test } from "bun:test"
import { assertNotBreached, PasswordBreaches } from "@audit/core/admin/passwords"
import { Effect } from "effect"

/** SHA-1 of "password" is 5BAA61E4…; the range API is queried by the first five characters. */
const PASSWORD = "password"
const RANGE_BODY =
  "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0000000000000000000000000000000000A:1"

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Stubs the outbound HTTP boundary and records every range request. */
const stubRange = (respond: () => Response) => {
  const requests: { url: string; headers: Headers }[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) })
    return respond()
  }) as typeof fetch
  return requests
}

/** The refusal message, or null when the password passes. */
const refusal = (password: string, enabled: boolean) =>
  assertNotBreached(password, enabled).pipe(
    Effect.as<string | null>(null),
    Effect.catch((error) => Effect.succeed(error.message)),
    Effect.provide(PasswordBreaches.live),
    Effect.runPromise,
  )

describe("breached-password check", () => {
  test("does not call the range API when the workspace turned the check off", async () => {
    const requests = stubRange(() => new Response(RANGE_BODY))
    expect(await refusal(PASSWORD, false)).toBeNull()
    expect(requests).toHaveLength(0)
  })

  test("refuses a password that appears in the range response", async () => {
    const requests = stubRange(() => new Response(RANGE_BODY))
    expect(await refusal(PASSWORD, true)).toBe(
      "This password appears in a known data breach. Choose another.",
    )
    expect(requests[0]?.url).toBe("https://api.pwnedpasswords.com/range/5BAA6")
    expect(requests[0]?.headers.get("Add-Padding")).toBe("true")
  })

  test("accepts a password whose suffix is absent from the range response", async () => {
    stubRange(() => new Response(RANGE_BODY))
    expect(await refusal("a-long-unique-passphrase-2024", true)).toBeNull()
  })

  test("fails closed with a clear message when the range API is unavailable", async () => {
    stubRange(() => new Response("unavailable", { status: 503 }))
    expect(await refusal(PASSWORD, true)).toBe(
      "Could not check the password right now. Try again shortly.",
    )
  })
})
