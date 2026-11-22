import { describe, expect, test } from "bun:test"
import { initials, isPathActive } from "./path.ts"

describe("isPathActive", () => {
  test("root only matches itself", () => {
    expect(isPathActive("/", "/")).toBe(true)
    expect(isPathActive("/docs", "/")).toBe(false)
  })

  test("matches the exact path and its children, not prefixes", () => {
    expect(isPathActive("/docs", "/docs")).toBe(true)
    expect(isPathActive("/docs/abc", "/docs")).toBe(true)
    expect(isPathActive("/docs-archive", "/docs")).toBe(false)
  })
})

describe("initials", () => {
  test("takes the first letters of the first two words", () => {
    expect(initials("ada lovelace")).toBe("AL")
    expect(initials("  grace   brewster hopper ")).toBe("GB")
  })

  test("handles a single word and an empty name", () => {
    expect(initials("madonna")).toBe("M")
    expect(initials("")).toBe("")
  })
})
