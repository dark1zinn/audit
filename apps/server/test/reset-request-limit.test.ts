import { describe, expect, test } from "bun:test"
import { makeResetRequestLimit } from "../src/reset-request-limit.ts"

const clock = () => {
  let now = 1_000_000
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe("makeResetRequestLimit", () => {
  test("allows three requests per email in an hour, whatever the address case", () => {
    const time = clock()
    const limit = makeResetRequestLimit(time.now)
    expect(limit.allow("Ada@Example.com")).toBe(true)
    expect(limit.allow("ada@example.com")).toBe(true)
    expect(limit.allow(" ada@example.com ")).toBe(true)
    expect(limit.allow("ada@example.com")).toBe(false)
  })

  test("other emails are not affected", () => {
    const time = clock()
    const limit = makeResetRequestLimit(time.now)
    for (let i = 0; i < 3; i++) limit.allow("ada@example.com")
    expect(limit.allow("grace@example.com")).toBe(true)
  })

  test("the allowance returns once the hour has passed", () => {
    const time = clock()
    const limit = makeResetRequestLimit(time.now)
    for (let i = 0; i < 3; i++) limit.allow("ada@example.com")
    time.advance(59 * 60_000)
    expect(limit.allow("ada@example.com")).toBe(false)
    time.advance(60_000)
    expect(limit.allow("ada@example.com")).toBe(true)
  })
})
