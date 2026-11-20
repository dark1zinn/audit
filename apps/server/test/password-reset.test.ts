import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as identity from "@audit/core/identity/commands"
import { RESET_IDENTIFIER_PREFIX } from "@audit/core/identity/reset-token"
import { sha256Hex } from "@audit/platform/crypto"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { addPerson, type Person, runAs, setupWorkspace } from "@audit/testkit/fixtures"
import { type AuthHandle, makeAuth } from "../src/auth.ts"

let database: TestDatabase
let owner: Person
let member: Person
let auth: AuthHandle
const sent: string[] = []

beforeAll(async () => {
  database = await makeTestDatabase()
  owner = await setupWorkspace(database)
  member = await addPerson(database, owner, "Member", "member")
  auth = makeAuth({
    config: database.config,
    canSignIn: async () => true,
    trail: async () => {},
    sendResetPassword: async ({ url }) => {
      sent.push(url)
    },
    checkPassword: async () => null,
  })
}, 60_000)

afterAll(async () => {
  await auth.close()
  await database.drop()
})

const post = (path: string, body: unknown) =>
  auth.handler(
    new Request(new URL(`/api/auth${path}`, database.config.url).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", origin: database.config.url.origin },
      body: JSON.stringify(body),
    }),
  )

const tokenOf = (link: string) => new URL(link).searchParams.get("token") ?? ""

const storedIdentifiers = async (value: string) => {
  const rows = await database.superuser`
    select identifier from verification where value = ${value}`
  return rows.map((row: { identifier: unknown }) => String(row.identifier))
}

describe("password reset tokens", () => {
  test("a reset requested through Better Auth is stored hashed and works once", async () => {
    const before = sent.length
    const requested = await post("/request-password-reset", { email: owner.email })
    expect(requested.status).toBe(200)
    expect(sent.length).toBe(before + 1)

    const link = sent[before]!
    expect(new URL(link).pathname).toBe("/reset-password")
    const token = tokenOf(link)
    expect(token.length).toBeGreaterThan(0)
    expect(await storedIdentifiers(owner.userId)).toEqual([
      `${RESET_IDENTIFIER_PREFIX}${sha256Hex(token)}`,
    ])

    const reset = await post("/reset-password", { newPassword: "a-brand-new-passphrase", token })
    expect(reset.status).toBe(200)
    const replay = await post("/reset-password", { newPassword: "another-passphrase-1", token })
    expect(replay.status).not.toBe(200)

    const signIn = await post("/sign-in/email", {
      email: owner.email,
      password: "a-brand-new-passphrase",
    })
    expect(signIn.status).toBe(200)
  })

  test("a link issued by a workspace admin resets the password the same way", async () => {
    const link = await runAs(
      database,
      owner.actor,
    )(identity.createPasswordResetLink.execute(member.userId))
    const token = tokenOf(link.url)

    const reset = await post("/reset-password", { newPassword: "member-new-passphrase", token })
    expect(reset.status).toBe(200)

    const signIn = await post("/sign-in/email", {
      email: member.email,
      password: "member-new-passphrase",
    })
    expect(signIn.status).toBe(200)
  })
})
