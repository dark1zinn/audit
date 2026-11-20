/**
 * Shared plumbing for `scripts/drill.ts` and `scripts/upgrade-test.ts`: throwaway databases,
 * CLI subprocesses, table counts, and a live `/readyz` probe. Needs `pg_dump`, `pg_restore`,
 * and `psql` (the server's major version) on PATH; the CLI shells out to them.
 */
import { SQL } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const root = join(import.meta.dir, "..")
const cliEntry = join(root, "apps/server/src/cli.ts")
const adminUrl = "postgres://audit:audit@127.0.0.1:5432/audit"
const secretKey = "dev-only-secret-key-change-me-0123456789abcdef"

export const step = (message: string) => console.log(`==> ${message}`)

export const databaseName = (label: string) =>
  `audit_${label}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`

export const databaseUrl = (name: string) => `postgres://audit:audit@127.0.0.1:5432/${name}`

export const createDatabase = async (name: string) => {
  const admin = new SQL(adminUrl)
  try {
    await admin.unsafe(`CREATE DATABASE ${name}`)
  } finally {
    await admin.close()
  }
}

export const dropDatabase = async (name: string) => {
  const admin = new SQL(adminUrl)
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  } finally {
    await admin.close()
  }
}

export const tempDir = (label: string) => mkdtemp(join(tmpdir(), `audit-${label}-`))

export const removeDir = (path: string) => rm(path, { recursive: true, force: true })

export const freePort = () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") })
  const port = probe.port
  probe.stop(true)
  return port
}

/** Environment for CLI and server subprocesses against one database and data directory. */
export const appEnv = (options: {
  readonly database: string
  readonly dataDir: string
  readonly backupDir?: string
  readonly migrationsDir?: string
  readonly port: number
}): Record<string, string> => {
  const env: Record<string, string> = {
    ...(Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined),
    ) as Record<string, string>),
    AUDIT_URL: `http://127.0.0.1:${options.port}`,
    PORT: String(options.port),
    DATABASE_URL: options.database,
    AUDIT_SECRET_KEY: secretKey,
    DATA_DIR: options.dataDir,
    LOG_LEVEL: "warn",
  }
  if (options.backupDir !== undefined) env.BACKUP_DIR = options.backupDir
  if (options.migrationsDir !== undefined) env.MIGRATIONS_DIR = options.migrationsDir
  else delete env.MIGRATIONS_DIR
  return env
}

/** Runs `audit <args>`; throws with the captured output when the exit code is not 0. */
export const runCli = async (args: string[], env: Record<string, string>): Promise<string> => {
  console.log(`$ audit ${args.join(" ")}`)
  const proc = Bun.spawn(["bun", cliEntry, ...args], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (stdout.trim().length > 0) console.log(stdout.trimEnd())
  if (stderr.trim().length > 0) console.error(stderr.trimEnd())
  if (code !== 0) throw new Error(`audit ${args.join(" ")} exited with code ${code}`)
  return stdout
}

/** Row counts for every base table outside the system schemas, keyed by `schema.table`. */
export const tableCounts = async (url: string): Promise<Record<string, number>> => {
  const sql = new SQL(url)
  try {
    const tables = await sql<{ schema: string; name: string }[]>`
      select table_schema as schema, table_name as name
      from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('pg_catalog', 'information_schema')
      order by table_schema, table_name
    `
    const counts: Record<string, number> = {}
    for (const table of tables) {
      const [row] = await sql.unsafe<{ count: number }[]>(
        `select count(*)::int as count from "${table.schema}"."${table.name}"`,
      )
      counts[`${table.schema}.${table.name}`] = row?.count ?? 0
    }
    return counts
  } finally {
    await sql.close()
  }
}

/** Starts `audit serve`, waits for `/readyz` to return 200, then stops the server. */
export const serveUntilReady = async (env: Record<string, string>, url: string) => {
  console.log(`$ audit serve (${url})`)
  const server = Bun.spawn(["bun", cliEntry, "serve"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const deadline = Date.now() + 60_000
    let status = 0
    while (Date.now() < deadline) {
      if (server.exitCode !== null) {
        throw new Error(
          `serve exited with code ${server.exitCode}: ${await new Response(server.stderr).text()}`,
        )
      }
      try {
        status = (await fetch(`${url}/readyz`)).status
        if (status === 200) break
      } catch {
        // not listening yet
      }
      await Bun.sleep(250)
    }
    if (status !== 200) throw new Error(`/readyz returned ${status} within 60 s`)
    console.log(`/readyz: 200`)
  } finally {
    server.kill()
    await server.exited
  }
}
