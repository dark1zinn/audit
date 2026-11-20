import { rotateSecrets } from "@audit/core/admin/secret-rotation"
import { chainTrail } from "@audit/core/trail-chain"
import { TRAIL_KEY_PURPOSE } from "@audit/core/trail-key"
import { aiProviders, trailEvents, trailKey, workspace } from "@audit/db/schema"
import { type Sealed, Secrets, makeSecrets } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { type Person, exitAs, runAs, setupWorkspace, system } from "@audit/testkit/fixtures"
import { eq } from "drizzle-orm"
import { Effect, Exit, Redacted } from "effect"
import { afterAll, beforeAll, expect, test } from "bun:test"

const OLD = Redacted.make("old-secret-key-0123456789abcdef-0123456789")
const WRONG = Redacted.make("wrong-secret-key-0123456789abcdef-0123456")

let database: TestDatabase
let owner: Person
let providerId: string
let oldKey: Sealed
let oldVapid: Sealed

const openCurrent = (purpose: string, sealed: Sealed) =>
  runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const secrets = yield* Secrets
      return Redacted.value(yield* secrets.open(purpose, sealed))
    }),
  )

/** The VAPID seal stored in workspace.settings; the shape is written by vapidConfig. */
const storedVapidSeal = async (): Promise<Sealed> => {
  const [row] = await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select({ settings: workspace.settings })
        .from(workspace)
        .where(eq(workspace.id, 1))
        .pipe(Effect.orDie)
    }),
  )
  const settings: unknown = row?.settings
  if (typeof settings === "object" && settings !== null && "vapid" in settings) {
    const vapid: unknown = settings.vapid
    if (typeof vapid === "object" && vapid !== null && "sealed" in vapid) {
      // Boundary: jsonb is validated by the vapid writer; the sealed shape is {ciphertext, nonce}.
      return vapid.sealed as Sealed
    }
  }
  throw new Error("workspace has no sealed VAPID key")
}

const storedTrailKey = () =>
  runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db
        .select({ ciphertext: trailKey.keyCiphertext, nonce: trailKey.keyNonce })
        .from(trailKey)
        .where(eq(trailKey.id, 1))
        .pipe(Effect.orDie)
      return { ciphertext: row?.ciphertext ?? "", nonce: row?.nonce ?? "" }
    }),
  )

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  oldKey = await Effect.runPromise(makeSecrets(OLD).seal("ai-key", "sk-live-abcd1234"))
  oldVapid = await Effect.runPromise(makeSecrets(OLD).seal("vapid", "vapid-private-key"))
  // setupWorkspace wrote trail events; chaining them creates the trail key under the test secret.
  // Move that key to OLD.
  await runAs(database, system)(chainTrail)
  const trailPlain = await openCurrent(TRAIL_KEY_PURPOSE, await storedTrailKey())
  const trailOld = await Effect.runPromise(makeSecrets(OLD).seal(TRAIL_KEY_PURPOSE, trailPlain))
  await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      yield* db
        .update(trailKey)
        .set({ keyCiphertext: trailOld.ciphertext, keyNonce: trailOld.nonce })
        .where(eq(trailKey.id, 1))
        .pipe(Effect.orDie)
    }),
  )
  providerId = await runAs(
    database,
    owner.actor,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db
        .insert(aiProviders)
        .values({
          kind: "openai_compatible",
          name: "Rotated",
          chatModel: "chat",
          embeddingModel: "embed",
          embeddingDimensions: 1536,
          keyCiphertext: oldKey.ciphertext,
          keyNonce: oldKey.nonce,
          keyLast4: "1234",
        })
        .returning({ id: aiProviders.id })
        .pipe(Effect.orDie)
      yield* db
        .update(workspace)
        .set({ settings: { vapid: { publicKey: "pub", sealed: oldVapid } } })
        .where(eq(workspace.id, 1))
        .pipe(Effect.orDie)
      return row?.id ?? ""
    }),
  )
}, 60_000)

afterAll(() => database.drop())

test("rotation re-encrypts AI keys and the VAPID key under the current secret", async () => {
  const result = await runAs(database, system)(rotateSecrets(OLD).execute({}))
  expect(result).toEqual({ aiKeys: 1, vapid: true })

  const [row] = await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select({
          ciphertext: aiProviders.keyCiphertext,
          nonce: aiProviders.keyNonce,
          last4: aiProviders.keyLast4,
        })
        .from(aiProviders)
        .where(eq(aiProviders.id, providerId as never))
        .pipe(Effect.orDie)
    }),
  )
  expect(row?.last4).toBe("1234")
  const keyPlain = await openCurrent("ai-key", {
    ciphertext: row?.ciphertext ?? "",
    nonce: row?.nonce ?? "",
  })
  expect(keyPlain).toBe("sk-live-abcd1234")
  expect(await openCurrent("vapid", await storedVapidSeal())).toBe("vapid-private-key")

  const entries = await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select({ action: trailEvents.action })
        .from(trailEvents)
        .where(eq(trailEvents.action, "secret.rotated"))
        .pipe(Effect.orDie)
    }),
  )
  expect(entries.length).toBe(1)
})

test("a wrong previous secret fails clearly and leaves stored values unchanged", async () => {
  const exit = await exitAs(database, system)(rotateSecrets(WRONG).execute({}))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(await openCurrent("vapid", await storedVapidSeal())).toBe("vapid-private-key")
})

test("only the system may rotate secrets", async () => {
  const exit = await exitAs(database, owner.actor)(rotateSecrets(OLD).execute({}))
  expect(Exit.isFailure(exit)).toBe(true)
})

test("rotation re-seals the trail HMAC key under the current secret", async () => {
  const other = Redacted.make("other-secret-key-0123456789abcdef-0123456789")
  const plaintext = await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      const [row] = yield* db
        .select({ ciphertext: trailKey.keyCiphertext, nonce: trailKey.keyNonce })
        .from(trailKey)
        .where(eq(trailKey.id, 1))
        .pipe(Effect.orDie)
      const secrets = yield* Secrets
      return Redacted.value(
        yield* secrets.open(TRAIL_KEY_PURPOSE, {
          ciphertext: row?.ciphertext ?? "",
          nonce: row?.nonce ?? "",
        }),
      )
    }),
  )

  // Seal every stored value under `other`, so rotation from `other` has something to move.
  const trailSealed = await Effect.runPromise(makeSecrets(other).seal(TRAIL_KEY_PURPOSE, plaintext))
  const aiSealed = await Effect.runPromise(makeSecrets(other).seal("ai-key", "sk-live-abcd1234"))
  const vapidSealed = await Effect.runPromise(makeSecrets(other).seal("vapid", "vapid-private-key"))
  await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      yield* db
        .update(trailKey)
        .set({ keyCiphertext: trailSealed.ciphertext, keyNonce: trailSealed.nonce })
        .where(eq(trailKey.id, 1))
        .pipe(Effect.orDie)
      yield* db
        .update(aiProviders)
        .set({ keyCiphertext: aiSealed.ciphertext, keyNonce: aiSealed.nonce })
        .where(eq(aiProviders.id, providerId as never))
        .pipe(Effect.orDie)
      yield* db
        .update(workspace)
        .set({ settings: { vapid: { publicKey: "pub", sealed: vapidSealed } } })
        .where(eq(workspace.id, 1))
        .pipe(Effect.orDie)
    }),
  )

  const result = await runAs(database, system)(rotateSecrets(other).execute({}))
  expect(result).toEqual({ aiKeys: 1, vapid: true })

  const [row] = await runAs(
    database,
    system,
  )(
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db
        .select({ ciphertext: trailKey.keyCiphertext, nonce: trailKey.keyNonce })
        .from(trailKey)
        .where(eq(trailKey.id, 1))
        .pipe(Effect.orDie)
    }),
  )
  expect(
    await openCurrent(TRAIL_KEY_PURPOSE, {
      ciphertext: row?.ciphertext ?? "",
      nonce: row?.nonce ?? "",
    }),
  ).toBe(plaintext)
})
