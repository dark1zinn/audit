/**
 * `bun run e2e`: builds the web app, starts the server on a fresh database, runs the Playwright
 * suite in apps/web against it, and tears everything down. Arguments after `--` go to
 * `playwright test`. Exits with Playwright's exit code.
 *
 * With `E2E_IMAGE=<image>`, the server is that container image (host networking) instead of the
 * source tree, so CI can run the suite against the image it is about to publish.
 */
import { SQL } from "bun"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const webDir = join(root, "apps/web")
const serverDir = join(root, "apps/server")
const devDatabaseUrl = "postgres://audit:audit@127.0.0.1:5432/audit"
const secretKey = "dev-only-secret-key-change-me-0123456789abcdef"
const setupToken = `e2e-setup-${crypto.randomUUID()}`
const databaseName = `audit_e2e_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
const image = process.env.E2E_IMAGE || undefined
const containerName = `audit-e2e-${databaseName}`

const log = (message: string) => console.log(`[e2e] ${message}`)

const runToEnd = async (cmd: string[], cwd: string, env?: Record<string, string>) => {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: env === undefined ? process.env : { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  })
  return proc.exited
}

const freePort = () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") })
  const port = probe.port
  probe.stop(true)
  return port
}

const createDatabase = async () => {
  const admin = new SQL(devDatabaseUrl)
  try {
    await admin.unsafe(`CREATE DATABASE ${databaseName}`)
  } finally {
    await admin.close()
  }
}

const dropDatabase = async () => {
  const admin = new SQL(devDatabaseUrl)
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
  } finally {
    await admin.close()
  }
}

const waitForServer = async (url: string, server: Bun.Subprocess) => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited with code ${server.exitCode}`)
    try {
      const response = await fetch(`${url}/api/setup`)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await Bun.sleep(300)
  }
  throw new Error(`server did not become ready at ${url} within 60s`)
}

let server: Bun.Subprocess | undefined
let exitCode = 1
let serverLog = ""

try {
  if (image === undefined) {
    log("building web app")
    const buildCode = await runToEnd(["bun", "run", "build:web"], root)
    if (buildCode !== 0) throw new Error(`build:web failed with code ${buildCode}`)
  }

  log(`creating database ${databaseName}`)
  await createDatabase()

  const port = freePort()
  const url = `http://127.0.0.1:${port}`
  const logDir = await mkdtemp(join(tmpdir(), "audit-e2e-"))
  serverLog = join(logDir, "server.log")
  const serverEnv: Record<string, string> = {
    AUDIT_URL: url,
    PORT: String(port),
    DATABASE_URL: `postgres://audit:audit@127.0.0.1:5432/${databaseName}`,
    AUDIT_SECRET_KEY: secretKey,
    SETUP_TOKEN: setupToken,
    // The assistant spec's mock provider listens on 127.0.0.1.
    AI_ALLOW_PRIVATE_BASE_URL: "true",
  }

  log(`starting ${image ?? "server"} at ${url} (log: ${serverLog})`)
  server =
    image === undefined
      ? Bun.spawn(["bun", "src/cli.ts", "serve"], {
          cwd: serverDir,
          env: { ...process.env, ...serverEnv, WEB_DIST: "../web/dist" },
          stdout: Bun.file(serverLog),
          stderr: Bun.file(serverLog),
        })
      : Bun.spawn(
          [
            "docker",
            "run",
            "--rm",
            "--name",
            containerName,
            "--network",
            "host",
            ...Object.entries(serverEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
            image,
          ],
          { stdout: Bun.file(serverLog), stderr: Bun.file(serverLog) },
        )
  await waitForServer(url, server)
  log("server ready")

  log("running playwright")
  exitCode = await runToEnd(
    ["bunx", "--bun", "playwright", "test", ...process.argv.slice(2)],
    webDir,
    {
      E2E_BASE_URL: url,
      E2E_SETUP_TOKEN: setupToken,
    },
  )
} catch (error) {
  console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  if (server !== undefined) {
    if (image === undefined) server.kill()
    else await runToEnd(["docker", "stop", "--time", "30", containerName], root)
    await server.exited
  }
  try {
    await dropDatabase()
  } catch (error) {
    console.error(`[e2e] could not drop ${databaseName}: ${String(error)}`)
    exitCode = 1
  }
  log(
    exitCode === 0
      ? `passed; database ${databaseName} dropped`
      : `failed with exit code ${exitCode}; server log: ${serverLog}`,
  )
}

process.exit(exitCode)
