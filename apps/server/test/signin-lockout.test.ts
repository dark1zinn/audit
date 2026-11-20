import { describe, expect, test } from "bun:test"
import { makeSignInLockout } from "../src/signin-lockout.ts"

const clock = () => {
  let now = 1_000_000
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

describe("makeSignInLockout", () => {
  test("allows five failures, then locks the email with backoff", () => {
    const time = clock()
    const lockout = makeSignInLockout(time.now)
    for (let i = 0; i < 5; i++) lockout.recordFailure("Ada@Example.com")
    expect(lockout.lockedFor("ada@example.com")).toBeNull()

    lockout.recordFailure("ada@example.com")
    expect(lockout.lockedFor("ada@example.com")).toBe(30)

    time.advance(30_000)
    expect(lockout.lockedFor("ada@example.com")).toBeNull()

    lockout.recordFailure("ada@example.com")
    expect(lockout.lockedFor("ada@example.com")).toBe(60)
  })

  test("backoff is capped", () => {
    const time = clock()
    const lockout = makeSignInLockout(time.now)
    for (let i = 0; i < 30; i++) lockout.recordFailure("ada@example.com")
    expect(lockout.lockedFor("ada@example.com")).toBe(900)
  })

  test("a successful sign-in clears the count for that email only", () => {
    const time = clock()
    const lockout = makeSignInLockout(time.now)
    for (let i = 0; i < 6; i++) lockout.recordFailure("ada@example.com")
    lockout.recordFailure("bob@example.com")
    lockout.reset("ada@example.com")
    expect(lockout.lockedFor("ada@example.com")).toBeNull()
    expect(lockout.lockedFor("bob@example.com")).toBeNull()
  })

  test("the count restarts after an hour without failures", () => {
    const time = clock()
    const lockout = makeSignInLockout(time.now)
    for (let i = 0; i < 6; i++) lockout.recordFailure("ada@example.com")
    time.advance(61 * 60_000)
    lockout.recordFailure("ada@example.com")
    expect(lockout.lockedFor("ada@example.com")).toBeNull()
  })
})
