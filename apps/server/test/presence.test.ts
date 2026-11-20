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

const createPage = (title: string) =>
  runAs(
    database,
    owner.actor,
  )(createDoc.execute({ parentId: WORKSPACE_SPACE_ID as EntityId, title })).then(
    (doc) => doc.id as EntityId,
  )

const run = <A, E>(effect: Effect.Effect<A, E, Presence>) =>
  database.runtime.runPromise(effect.pipe(Effect.provide(Presence.layer), Effect.scoped))

describe("presence focus", () => {
  test("focus is refused outside the entity scope it names", async () => {
    const page = await createPage("Board plan")
    const outcome = await run(
      Effect.gen(function* () {
        const presence = yield* Presence
        const join = yield* presence
          .join("workspace")
          .pipe(Stream.provideService(CurrentActor, owner.actor), Stream.runDrain, Effect.forkChild)
        yield* Effect.sleep("50 millis")
        const workspace = yield* presence
          .update({ scope: "workspace", focusEntityId: page })
          .pipe(Effect.provideService(CurrentActor, owner.actor))
        yield* Fiber.interrupt(join)
        return workspace
      }),
    )
    expect(outcome).toEqual({ accepted: false })
  })

  test("focus on a different entity than the scope is refused", async () => {
    const page = await createPage("Scope page")
    const other = await createPage("Other page")
    const outcome = await run(
      Effect.gen(function* () {
        const presence = yield* Presence
        const join = yield* presence
          .join(`entity:${page}`)
          .pipe(Stream.provideService(CurrentActor, owner.actor), Stream.runDrain, Effect.forkChild)
        yield* Effect.sleep("50 millis")
        const result = yield* presence
          .update({ scope: `entity:${page}`, focusEntityId: other })
          .pipe(Effect.provideService(CurrentActor, owner.actor))
        yield* Fiber.interrupt(join)
        return result
      }),
    )
    expect(outcome).toEqual({ accepted: false })
  })

  test("viewers of an entity scope see the focus on that entity", async () => {
    const page = await createPage("Shared page")
    const seenByMember = await run(
      Effect.gen(function* () {
        const presence = yield* Presence
        const ownerJoin = yield* presence
          .join(`entity:${page}`)
          .pipe(Stream.provideService(CurrentActor, owner.actor), Stream.runDrain, Effect.forkChild)
        yield* Effect.sleep("50 millis")
        yield* presence
          .update({ scope: `entity:${page}`, focusEntityId: page })
          .pipe(Effect.provideService(CurrentActor, owner.actor))
        yield* Effect.sleep("50 millis")
        const [first] = yield* presence.join(`entity:${page}`).pipe(
          Stream.provideService(CurrentActor, member.actor),
          Stream.take(1),
          Stream.runCollect,
          Effect.map((chunk) => [...chunk]),
        )
        yield* Fiber.interrupt(ownerJoin)
        return first
      }),
    )

    const ownerView = seenByMember?.viewers.find((viewer) => viewer.userId === owner.userId)
    expect(ownerView?.focusEntityId).toBe(page)
  })
})
