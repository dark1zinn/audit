/**
 * `bun run drill`: restore drill. Migrates and seeds a throwaway source database, backs it up,
 * restores the backup into a fresh database with a fresh data directory, then checks table
 * counts, the restored file store, the audit log chain, and that the server becomes ready on the
 * restored data. Everything is removed afterwards. Exits 0 when every check passes, 1 otherwise.
 * Needs `pg_dump`, `pg_restore`, and `psql` on PATH (see docs/operations/restore-drill.md).
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  appEnv,
  createDatabase,
  databaseName,
  databaseUrl,
  dropDatabase,
  freePort,
  removeDir,
  runCli,
  serveUntilReady,
  step,
  tableCounts,
  tempDir,
} from "./ops-lib.ts"

const source = databaseName("drill_src")
const target = databaseName("drill_dst")
const fixture = { name: "drill-fixture.txt", body: `restore drill ${new Date().toISOString()}\n` }
const dirs: string[] = []
let failed = false

try {
  await createDatabase(source)
  await createDatabase(target)
  const sourceData = await tempDir("drill-src")
  const targetData = await tempDir("drill-dst")
  const backups = await tempDir("drill-backups")
  dirs.push(sourceData, targetData, backups)
  const port = freePort()
  const sourceEnv = appEnv({
    database: databaseUrl(source),
    dataDir: sourceData,
    backupDir: backups,
    port,
  })
  const targetEnv = appEnv({
    database: databaseUrl(target),
    dataDir: targetData,
    backupDir: backups,
    port,
  })

  step("migrate and seed the source database")
  await runCli(["migrate"], sourceEnv)
  await runCli(["seed", "--demo"], sourceEnv)
  await Bun.write(join(sourceData, "files", fixture.name), fixture.body)

  step("back up the source")
  const backupOutput = await runCli(["backup"], sourceEnv)
  const dir = backupOutput.match(/^Backup written to (.+?) \(/m)?.[1]
  if (dir === undefined) throw new Error("backup output did not name the backup directory")
  const sourceCounts = await tableCounts(databaseUrl(source))

  step("restore into an empty database with an empty data directory")
  await runCli(["restore", dir], targetEnv)

  step("compare table counts")
  const targetCounts = await tableCounts(databaseUrl(target))
  const mismatches = Object.keys({ ...sourceCounts, ...targetCounts }).filter(
    (table) => sourceCounts[table] !== targetCounts[table],
  )
  for (const table of mismatches) {
    console.error(
      `count mismatch ${table}: source ${sourceCounts[table]}, target ${targetCounts[table]}`,
    )
  }
  if (mismatches.length > 0) throw new Error(`${mismatches.length} table(s) differ`)
  console.log(`${Object.keys(targetCounts).length} tables match.`)

  step("compare the restored file store")
  const restored = await readFile(join(targetData, "files", fixture.name), "utf8")
  if (restored !== fixture.body) throw new Error("restored file differs from the source")
  console.log(`${fixture.name} matches.`)

  step("verify the audit log on the restored database")
  await runCli(["trail", "verify"], targetEnv)

  step("start the server on the restored data")
  await serveUntilReady(targetEnv, `http://127.0.0.1:${port}`)
  console.log("Drill passed.")
} catch (error) {
  failed = true
  console.error(`Drill FAILED: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await dropDatabase(source)
  await dropDatabase(target)
  for (const dir of dirs) await removeDir(dir)
}

process.exit(failed ? 1 : 0)
