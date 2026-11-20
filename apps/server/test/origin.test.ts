import { describe, expect, test } from "bun:test"
import { isSameOriginRequest, needsOriginCheck } from "../src/origin.ts"

const ORIGIN = "https://audit.example.com"

const request = (method: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/thing`, { method, headers })

describe("needsOriginCheck", () => {
  test("unsafe methods and WebSocket upgrades are checked; reads are not", () => {
    expect(needsOriginCheck(request("POST"))).toBe(true)
    expect(needsOriginCheck(request("DELETE"))).toBe(true)
    expect(needsOriginCheck(request("GET", { upgrade: "websocket" }))).toBe(true)
    expect(needsOriginCheck(request("GET"))).toBe(false)
    expect(needsOriginCheck(request("HEAD"))).toBe(false)
  })
})

describe("isSameOriginRequest", () => {
  test("accepts the app origin", () => {
    expect(isSameOriginRequest(request("POST", { origin: ORIGIN }), ORIGIN)).toBe(true)
  })

  test("refuses a cross-site origin, even with a same-origin fetch-site hint", () => {
    expect(
      isSameOriginRequest(
        request("POST", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }),
        ORIGIN,
      ),
    ).toBe(false)
  })

  test("refuses a null origin", () => {
    expect(isSameOriginRequest(request("POST", { origin: "null" }), ORIGIN)).toBe(false)
  })

  test("without Origin, plain requests accept only Sec-Fetch-Site same-origin", () => {
    expect(isSameOriginRequest(request("POST", { "sec-fetch-site": "same-origin" }), ORIGIN)).toBe(
      true,
    )
    expect(isSameOriginRequest(request("POST", { "sec-fetch-site": "cross-site" }), ORIGIN)).toBe(
      false,
    )
    expect(isSameOriginRequest(request("POST"), ORIGIN)).toBe(false)
  })

  test("without Origin, a WebSocket upgrade is accepted; a plain POST is still refused", () => {
    const upgrade = { upgrade: "websocket" }
    expect(isSameOriginRequest(request("GET", upgrade), ORIGIN)).toBe(true)
    expect(isSameOriginRequest(request("POST"), ORIGIN)).toBe(false)
  })
})
