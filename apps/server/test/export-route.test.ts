import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { PASSWORD, setupWorkspace, type Person } from "@audit/testkit/fixtures"
import { type RunningServer, startServer } from "../src/server.ts"

let db: TestDatabase
let running: RunningServer
let origin: string
let owner: Person
let cookie: string

const freePort = (): number => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port ?? 0
  probe.stop(true)
  return port
}

beforeAll(async () => {
  db = await makeTestDatabase()
  const port = freePort()
  origin = `http://localhost:${port}`
  running = await startServer({ ...db.config, port, url: new URL(origin) })
  owner = await setupWorkspace(db)
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: owner.email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}, 60_000)

afterAll(async () => {
  await running?.stop()
  await db?.drop()
})

describe("admin export route", () => {
  test("the export is a POST, so a GET navigation cannot start it", async () => {
    const response = await fetch(`${origin}/api/admin/export`, {
      headers: { cookie, origin },
    })
    expect(response.status).not.toBe(200)
  })

  test("an authenticated POST streams the export", async () => {
    const response = await fetch(`${origin}/api/admin/export`, {
      method: "POST",
      headers: { cookie, origin },
    })
    expect(response.status).toBe(200)
    await response.body?.cancel()
  })
})
