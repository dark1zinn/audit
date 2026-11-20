import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { type Person, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Effect, Exit } from "effect"
import type { AuthHandle } from "../src/auth.ts"
import { Sessions, sessionsLayer } from "../src/sessions.ts"

const DAY_MS = 86_400_000

let database: TestDatabase
let owner: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  await database.superuser`
    update workspace set settings = coalesce(settings, '{}'::jsonb) || '{"idleDays": 1}'::jsonb`
}, 60_000)

afterAll(() => database.drop())

/**
 * Stands in for Better Auth: a read refreshes `updatedAt` unless `disableRefresh` is set, which is
 * how the real `getSession` behaves for background rechecks.
 */
const fakeAuth = (updatedAt: Date) => {
  const session = { id: crypto.randomUUID(), updatedAt }
  const handle = {
    getSession: async (_headers: Headers, options?: { disableRefresh?: boolean }) => {
      if (options?.disableRefresh !== true) session.updatedAt = new Date()
      return { user: { id: owner.userId }, session }
    },
  }
  return handle as unknown as AuthHandle
}

const resolveWith = (auth: AuthHandle, mode: "refresh" | "no-refresh") =>
  database.runtime.runPromiseExit(
    Effect.gen(function* () {
      const sessions = yield* Sessions
      return mode === "refresh"
        ? yield* sessions.resolve(new Headers())
        : yield* sessions.resolveWithoutRefresh(new Headers())
    }).pipe(Effect.provide(sessionsLayer(auth))),
  )

describe("session lookups", () => {
  test("a background recheck does not extend an idle session", async () => {
    const auth = fakeAuth(new Date(Date.now() - 2 * DAY_MS))
    const exit = await resolveWith(auth, "no-refresh")
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toMatchObject({
        _tag: "Unauthorized",
        message: "The session expired after inactivity",
      })
    }
  })

  test("a background recheck keeps a recently used session", async () => {
    const auth = fakeAuth(new Date(Date.now() - 60_000))
    const exit = await resolveWith(auth, "no-refresh")
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("an ordinary lookup still refreshes the session it reads", async () => {
    const auth = fakeAuth(new Date(Date.now() - 2 * DAY_MS))
    const exit = await resolveWith(auth, "refresh")
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
