import { describe, expect, test } from "bun:test"
import { initialKeys, keyBetween, keysBetween } from "@audit/domain/ordering"

describe("fractional ordering keys", () => {
  test("a key always lands strictly between its neighbours", () => {
    let before = null as string | null
    let after = null as string | null
    for (let i = 0; i < 200; i++) {
      const key = keyBetween(before, after)
      if (before !== null) expect(key > before).toBe(true)
      if (after !== null) expect(key < after).toBe(true)
      // Repeatedly insert just before the last key: keys grow but stay ordered.
      after = key
    }
  })

  test("inserting between adjacent keys never collides", () => {
    const keys = [...initialKeys(5)]
    for (let i = 0; i < keys.length - 1; i++) {
      const mid = keyBetween(keys[i]!, keys[i + 1]!)
      expect(mid > keys[i]!).toBe(true)
      expect(mid < keys[i + 1]!).toBe(true)
    }
  })

  test("initial keys are strictly ascending and unique", () => {
    const keys = initialKeys(300)
    expect(new Set(keys).size).toBe(300)
    expect([...keys].sort()).toEqual([...keys])
  })

  test("keysBetween returns ascending keys inside the bounds", () => {
    const keys = keysBetween("a1", "a2", 25)
    expect(keys.length).toBe(25)
    expect([...keys].sort()).toEqual([...keys])
    for (const key of keys) {
      expect(key > "a1").toBe(true)
      expect(key < "a2").toBe(true)
    }
  })

  test("rejects keys that end in the zero digit or are out of order", () => {
    expect(() => keyBetween("a1", null)).not.toThrow()
    expect(() => keyBetween("b", "a")).toThrow()
    expect(() => keyBetween("a0", "a2")).toThrow()
  })
})
