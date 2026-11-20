import { describe, expect, test } from "bun:test"
import { clientIpFromForwarded } from "../src/client-ip.ts"

describe("clientIpFromForwarded", () => {
  test("one trusted proxy: the rightmost entry is the peer it saw, not a spoofed leftmost value", () => {
    expect(clientIpFromForwarded("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9")
  })

  test("two trusted proxies: skips the proxy appended last", () => {
    expect(clientIpFromForwarded("6.6.6.6, 203.0.113.9, 10.0.0.2", 2)).toBe("203.0.113.9")
  })

  test("fewer entries than trusted hops yields no client address", () => {
    expect(clientIpFromForwarded("203.0.113.9", 2)).toBeUndefined()
  })

  test("empty entry yields no client address", () => {
    expect(clientIpFromForwarded("203.0.113.9, ", 1)).toBeUndefined()
  })
})
