import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { checkBudget } from "@audit/core/ai/usage"
import type { AiSettings } from "@audit/domain/ai/schema"
import type { UserId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { Cause, Effect, Exit, Option } from "effect"

let database: TestDatabase

beforeAll(async () => {
  database = await makeTestDatabase()
}, 60_000)

afterAll(() => database.drop())

const unlimited: AiSettings = {
  enabled: true,
  defaultProviderId: null,
  embeddingProviderId: null,
  allowedRoles: ["owner", "admin", "member", "guest"],
  monthlyTokenBudget: null,
  conversationRetentionDays: 30,
  features: {
    assistant: true,
    semantic_search: true,
    summaries: true,
    doc_upkeep: true,
    editor: true,
    chat: true,
    board: true,
    calendar: true,
  },
}

describe("AI call rate limit", () => {
  test("a person calling far too fast is stopped even with no budget set", async () => {
    const userId = Bun.randomUUIDv7() as UserId
    const results = []
    for (let call = 0; call < 61; call++) {
      results.push(await database.runtime.runPromise(Effect.exit(checkBudget(userId, unlimited))))
    }
    expect(results.slice(0, 60).every(Exit.isSuccess)).toBe(true)

    const last = results[60]!
    const error = Exit.isFailure(last) ? Cause.findErrorOption(last.cause) : Option.none()
    expect(Option.getOrUndefined(error)).toMatchObject({ _tag: "RateLimited" })
  })
})
