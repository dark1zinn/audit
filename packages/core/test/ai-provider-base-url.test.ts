import { afterAll, beforeAll, expect, test } from "bun:test"
import { createProvider, testProvider, updateProvider } from "@audit/core/ai/commands"
import { CurrentActor } from "@audit/domain/actor"
import { ValidationError } from "@audit/domain/errors"
import { AppConfig } from "@audit/platform/config"
import { makeTestDatabase, type TestDatabase, type TestServices } from "@audit/testkit/database"
import { type Person, setupWorkspace } from "@audit/testkit/fixtures"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import * as HttpClient from "effect/http/HttpClient"

const PUBLIC_A = "https://93.184.216.34/v1"
const PUBLIC_B = "https://93.184.216.35/v1"
const PRIVATE = "https://10.20.30.40/v1"

/** Fails the test if a request leaves the process: the private URL must be refused first. */
const refusingHttp = HttpClient.make(() => Effect.die("no outbound request expected"))

let database: TestDatabase
let owner: Person

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(() => database.drop(), 60_000)

/** Runs a command as the owner, with `aiAllowPrivateBaseUrl` set as given, and returns its exit. */
const run = <A, E>(
  effect: Effect.Effect<A, E, TestServices | CurrentActor | AppConfig>,
  allowPrivate = false,
) =>
  database.runtime.runPromise(
    Effect.exit(
      effect.pipe(
        Effect.provideService(CurrentActor, owner.actor),
        Effect.provideService(AppConfig, {
          ...database.config,
          aiAllowPrivateBaseUrl: allowPrivate,
        }),
      ),
    ),
  )

const failureTag = <A, E>(exit: Exit.Exit<A, E>): string =>
  Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) => (error instanceof ValidationError ? "ValidationError" : "other")),
        Option.getOrElse(() => "no-error"),
      )
    : "success"

const create = (baseUrl: string, allowPrivate = false) =>
  run(
    createProvider.execute({
      kind: "openai_compatible",
      name: "Base URL check",
      baseUrl,
      apiKey: "sk-test-BASEURL-0001",
      chatModel: "chat-test",
    }),
    allowPrivate,
  )

test("createProvider rejects a plain http base URL", async () => {
  expect(failureTag(await create("http://93.184.216.34/v1"))).toBe("ValidationError")
})

test("createProvider rejects private hosts unless aiAllowPrivateBaseUrl is set", async () => {
  expect(failureTag(await create(PRIVATE))).toBe("ValidationError")
  expect(failureTag(await create("https://127.0.0.1:8443/v1"))).toBe("ValidationError")
  expect(failureTag(await create("https://169.254.169.254/latest"))).toBe("ValidationError")
  expect(failureTag(await create("https://localhost:11434/v1"))).toBe("ValidationError")
  expect(failureTag(await create(PRIVATE, true))).toBe("success")
})

test("createProvider accepts a public https base URL", async () => {
  expect(failureTag(await create(PUBLIC_A))).toBe("success")
})

test("changing baseUrl requires a new apiKey in the same request", async () => {
  const created = await run(
    createProvider.execute({
      kind: "openai_compatible",
      name: "Change URL",
      baseUrl: PUBLIC_A,
      apiKey: "sk-test-BASEURL-0002",
      chatModel: "chat-test",
    }),
  )
  if (Exit.isFailure(created)) throw new Error("setup failed")
  const providerId = created.value.id

  const changedWithoutKey = await run(
    updateProvider.execute({ providerId, patch: { baseUrl: PUBLIC_B } }),
  )
  expect(failureTag(changedWithoutKey)).toBe("ValidationError")

  const changedWithEmptyKey = await run(
    updateProvider.execute({ providerId, patch: { baseUrl: PUBLIC_B, apiKey: "" } }),
  )
  expect(failureTag(changedWithEmptyKey)).toBe("ValidationError")

  const unchangedWithoutKey = await run(
    updateProvider.execute({ providerId, patch: { baseUrl: PUBLIC_A, name: "Still here" } }),
  )
  expect(failureTag(unchangedWithoutKey)).toBe("success")

  const changedWithKey = await run(
    updateProvider.execute({
      providerId,
      patch: { baseUrl: PUBLIC_B, apiKey: "sk-test-BASEURL-0003" },
    }),
  )
  expect(failureTag(changedWithKey)).toBe("success")

  const toPrivateWithKey = await run(
    updateProvider.execute({
      providerId,
      patch: { baseUrl: PRIVATE, apiKey: "sk-test-BASEURL-0004" },
    }),
  )
  expect(failureTag(toPrivateWithKey)).toBe("ValidationError")
})

test("connection test refuses a stored private base URL", async () => {
  const created = await create(PRIVATE, true)
  if (Exit.isFailure(created)) throw new Error("setup failed")
  const exit = await run(
    testProvider
      .execute({ providerId: created.value.id })
      .pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient, refusingHttp))),
  )
  expect(failureTag(exit)).toBe("ValidationError")
})
