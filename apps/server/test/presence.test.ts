import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createDoc } from "@audit/core/docs/commands"
import { CurrentActor } from "@audit/domain/actor"
import { WORKSPACE_SPACE_ID } from "@audit/domain/docs/schema"
import type { EntityId } from "@audit/domain/ids"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { Effect, Fiber, Stream } from "effect"
import { Presence } from "../src/presence.ts"

let database: TestDatabase
let owner: Person
let member: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Mia", "member")
}, 60_000)

afterAll(() => database.drop())

describe("presence focus", () => {
  test("a viewer who cannot read the focused entity sees the focus cleared", async () => {
    const secret = await runAs(
      database,
      owner.actor,
    )(createDoc.execute({ parentId: WORKSPACE_SPACE_ID as EntityId, title: "Board plan" }))
    await database.superuser`update entities set restricted = true where id = ${secret.id}`
    const focusEntityId = secret.id as EntityId

    const seenByMember = await database.runtime.runPromise(
      Effect.gen(function* () {
        const presence = yield* Presence
        const ownerJoin = yield* presence
          .join("workspace")
          .pipe(Stream.provideService(CurrentActor, owner.actor), Stream.runDrain, Effect.forkChild)
        yield* Effect.sleep("50 millis")
        yield* presence
          .update({ scope: "workspace", focusEntityId })
          .pipe(Effect.provideService(CurrentActor, owner.actor))
        yield* Effect.sleep("50 millis")
        const [first] = yield* presence.join("workspace").pipe(
          Stream.provideService(CurrentActor, member.actor),
          Stream.take(1),
          Stream.runCollect,
          Effect.map((chunk) => [...chunk]),
        )
        yield* Fiber.interrupt(ownerJoin)
        return first
      }).pipe(Effect.provide(Presence.layer), Effect.scoped),
    )

    const ownerView = seenByMember?.viewers.find((viewer) => viewer.userId === owner.userId)
    expect(ownerView).toBeDefined()
    expect(ownerView?.focusEntityId).toBeNull()
  })
})
