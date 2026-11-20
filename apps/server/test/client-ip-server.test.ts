import { afterAll, beforeAll, expect, test } from "bun:test"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { PASSWORD, type Person, setupWorkspace } from "@audit/testkit/fixtures"
import { CLIENT_IP_HEADER } from "../src/client-ip.ts"
import { type RunningServer, startServer } from "../src/server.ts"

let database: TestDatabase
let running: RunningServer | undefined
let owner: Person
let origin = ""

const freePort = (): number => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port ?? 0
  probe.stop(true)
  return port
}

beforeAll(async () => {
  database = await makeTestDatabase()
  const port = freePort()
  // IPv6 loopback: Better Auth falls back to 127.0.0.1 under NODE_ENV=test, so only an address
  // stamped from the socket can read ::1.
  origin = `http://[::1]:${port}`
  running = await startServer({ ...database.config, port, url: new URL(origin) })
  owner = await setupWorkspace(database)
}, 60_000)

afterAll(async () => {
  await running?.stop()
  await database?.drop()
})

// Rate limits, sessions and the audit trail key on this address. It must come from the socket
// (no trusted proxy configured), never from a header the client sends.
test("a sign-in through the server records the socket address, not a client-sent one", async () => {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      [CLIENT_IP_HEADER]: "203.0.113.9",
    },
    body: JSON.stringify({ email: owner.email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)

  const sessions = await database.superuser<{ ip: string | null }[]>`
    select ip_address as ip from session where user_id = ${owner.userId}`
  expect(sessions.length).toBeGreaterThan(0)
  for (const session of sessions) {
    // Better Auth stores IPv6 addresses masked to their /64; any IPv6 form proves the socket was used.
    expect(session.ip).not.toBe("127.0.0.1")
    expect(session.ip).not.toBe("203.0.113.9")
    expect(session.ip ?? "").toContain(":")
  }
})
