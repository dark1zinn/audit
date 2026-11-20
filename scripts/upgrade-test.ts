/**
 * `bun run test:upgrade`: upgrade drill. Migrates a source database with a copy of the migrations
 * minus the newest one (what a deployed backup looks like before this release), backs it up,
 * restores it into a fresh database with this build's migrations, and checks that the restore
 * migrated forward, the audit log verifies, and the server becomes ready. Exits 0 on success.
 * The "previous" migration set is copied from packages/db/drizzle at run time, so the test keeps
 * working as migrations are added; see docs/operations/restore-drill.md.
 */
import { cp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import {
  appEnv,
  createDatabase,
  databaseName,
  databaseUrl,
  dropDatabase,
  freePort,
  removeDir,
  root,
  runCli,
  serveUntilReady,
  step,
  tempDir,
} from "./ops-lib.ts"

const bundledDir = join(root, "packages/db/drizzle")
const source = databaseName("upgrade_src")
const target = databaseName("upgrade_dst")
const dirs: string[] = []
let failed = false

try {
  const migrations = (await readdir(bundledDir)).toSorted()
  const newest = migrations.at(-1)
  if (newest === undefined || migrations.length < 2) {
    throw new Error("need at least two migrations to build the previous set")
  }
  const previousDir = await tempDir("upgrade-migrations")
  dirs.push(previousDir)
  await cp(bundledDir, previousDir, { recursive: true })
  await rm(join(previousDir, newest), { recursive: true, force: true })
  const previousCount = migrations.length - 1
  console.log(
    `previous migration set: ${previousCount} of ${migrations.length} (without ${newest})`,
  )

  await createDatabase(source)
  await createDatabase(target)
  const sourceData = await tempDir("upgrade-src")
  const targetData = await tempDir("upgrade-dst")
  const backups = await tempDir("upgrade-backups")
  dirs.push(sourceData, targetData, backups)
  const port = freePort()
  const previousEnv = appEnv({
    database: databaseUrl(source),
    dataDir: sourceData,
    backupDir: backups,
    migrationsDir: previousDir,
    port,
  })
  const currentEnv = appEnv({
    database: databaseUrl(target),
    dataDir: targetData,
    backupDir: backups,
    port,
  })

  step("migrate the source with the previous migration set")
  await runCli(["migrate"], previousEnv)

  step("back up the previous-version database")
  const backupOutput = await runCli(["backup"], previousEnv)
  const dir = backupOutput.match(/^Backup written to (.+?) \(/m)?.[1]
  if (dir === undefined) throw new Error("backup output did not name the backup directory")

  step("restore into a fresh database with this build's migrations")
  const restoreOutput = await runCli(["restore", dir], currentEnv)
  if (!restoreOutput.includes(`backup had ${previousCount} migrations`)) {
    throw new Error(`restore did not report ${previousCount} migrations in the backup`)
  }

  step("verify the audit log on the upgraded database")
  await runCli(["trail", "verify"], currentEnv)

  step("start the server on the upgraded database")
  await serveUntilReady(currentEnv, `http://127.0.0.1:${port}`)
  console.log("Upgrade test passed.")
} catch (error) {
  failed = true
  console.error(`Upgrade test FAILED: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await dropDatabase(source)
  await dropDatabase(target)
  for (const dir of dirs) await removeDir(dir)
}

process.exit(failed ? 1 : 0)
