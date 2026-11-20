import { expect, test } from "bun:test"
import { validateBaseUrl } from "@audit/ai/provider"
import { Effect, Exit } from "effect"

const outcome = (raw: string, allowPrivate = false) =>
  Effect.runPromise(Effect.exit(validateBaseUrl(raw, { allowPrivate }))).then((exit) =>
    Exit.isSuccess(exit) ? "ok" : "rejected",
  )

const accepts = async (raw: string, allowPrivate = false) =>
  expect(await outcome(raw, allowPrivate)).toBe("ok")
const rejects = async (raw: string, allowPrivate = false) =>
  expect(await outcome(raw, allowPrivate)).toBe("rejected")

test("public https hosts are accepted", async () => {
  await accepts("https://93.184.216.34/v1")
  await accepts("https://[2606:2800:220:1:248:1893:25c8:1946]/v1")
})

test("non-https schemes are rejected", async () => {
  await rejects("http://93.184.216.34/v1")
  await rejects("ftp://93.184.216.34/v1")
  await rejects("http://93.184.216.34/v1", true)
})

test("unparsable URLs are rejected", async () => {
  await rejects("not a url")
  await rejects("")
})

test("URLs with credentials are rejected", async () => {
  await rejects("https://user:secret@93.184.216.34/v1")
  await rejects("https://user@93.184.216.34/v1")
})

test("loopback, private, link-local and special addresses are rejected by default", async () => {
  await rejects("https://127.0.0.1:8080/v1")
  await rejects("https://127.8.9.10/v1")
  await rejects("https://10.1.2.3/v1")
  await rejects("https://172.16.0.1/v1")
  await rejects("https://172.31.255.255/v1")
  await rejects("https://192.168.1.1/v1")
  await rejects("https://169.254.169.254/latest")
  await rejects("https://100.64.0.1/v1")
  await rejects("https://0.0.0.0/v1")
  await rejects("https://[::1]/v1")
  await rejects("https://[::]/v1")
  await rejects("https://[fe80::1]/v1")
  await rejects("https://[fc00::1]/v1")
  await rejects("https://[fd12:3456::1]/v1")
  await rejects("https://[::ffff:127.0.0.1]/v1")
  await rejects("https://[::ffff:169.254.169.254]/v1")
  await rejects("https://localhost:11434/v1")
  await rejects("https://LOCALHOST/v1")
  await rejects("https://api.localhost/v1")
})

test("addresses just outside the private ranges are accepted", async () => {
  await accepts("https://172.32.0.1/v1")
  await accepts("https://100.128.0.1/v1")
})

test("hostnames that do not resolve are rejected", async () => {
  await rejects("https://no-such-host.invalid/v1")
})

test("private hosts are accepted only when allowed", async () => {
  await accepts("https://127.0.0.1:8080/v1", true)
  await accepts("https://10.1.2.3/v1", true)
  await accepts("https://169.254.169.254/latest", true)
  await accepts("https://localhost:11434/v1", true)
  await accepts("https://[::1]/v1", true)
  // Allowing private hosts also allows plain http to them (local model servers), but never
  // http to a public host or embedded credentials.
  await accepts("http://127.0.0.1:8080/v1", true)
  await accepts("http://localhost:11434/v1", true)
  await accepts("http://10.1.2.3/v1", true)
  await rejects("https://user:pass@127.0.0.1/v1", true)
})
