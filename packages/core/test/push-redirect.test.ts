import { expect, test } from "bun:test"
import { postPush } from "@audit/core/notifications/push"

test("the web push POST does not follow a redirect", async () => {
  let targetHits = 0
  const target = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      targetHits++
      return new Response(null, { status: 201 })
    },
  })
  const endpoint = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(null, {
        status: 307,
        headers: { location: `http://127.0.0.1:${target.port}/` },
      }),
  })
  try {
    const response = await postPush(`http://127.0.0.1:${endpoint.port}/push`, {
      method: "POST",
      body: new Uint8Array([1]),
    })
    expect(response.status).toBe(307)
    expect(targetHits).toBe(0)
  } finally {
    target.stop(true)
    endpoint.stop(true)
  }
})
