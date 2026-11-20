import { afterEach, expect, test } from "bun:test"
import { makeTestDatabase, type TestDatabase } from "@audit/testkit/database"
import { type RunningServer, startServer } from "../src/server.ts"

const opened: Array<{ database: TestDatabase; running: RunningServer }> = []

afterEach(async () => {
  for (const { database, running } of opened.splice(0)) {
    await running.stop()
    await database.drop()
  }
})

const freePort = (): number => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port ?? 0
  probe.stop(true)
  return port
}

/** Statuses of `attempts` failed sign-ins (distinct emails) from this host within one minute. */
const signInStatuses = async (signInPerIpPerMinute: number | undefined, attempts: number) => {
  const database = await makeTestDatabase()
  const port = freePort()
  const origin = `http://127.0.0.1:${port}`
  const running = await startServer({
    ...database.config,
    ...(signInPerIpPerMinute === undefined ? {} : { signInPerIpPerMinute }),
    port,
    url: new URL(origin),
  })
  opened.push({ database, running })
  const statuses: number[] = []
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: `nobody${attempt}@example.test`,
        password: "wrong password 1",
      }),
    })
    statuses.push(response.status)
  }
  return statuses
}

test("the per-IP sign-in limit comes from configuration", async () => {
  expect(await signInStatuses(2, 3)).toEqual([401, 401, 429])
}, 60_000)

test("the default lets more than five people behind one address sign in within a minute", async () => {
  const statuses = await signInStatuses(undefined, 8)
  expect(statuses.filter((status) => status === 429)).toEqual([])
}, 60_000)
