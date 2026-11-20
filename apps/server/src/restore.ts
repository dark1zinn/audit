/**
 * `audit restore <path>`: checks a backup directory (manifest, checksums, migration compatibility),
 * then loads it into the configured database and file store and migrates it forward to this build.
 * Nothing is changed until every check passes.
 */
import { migrateDatabase } from "@audit/platform/database"
import type { AppConfigShape } from "@audit/platform/config"
import { SQL } from "bun"
import { Effect, Redacted, Schema } from "effect"
import * as Command from "@audit/core/command"
import { record } from "@audit/core/trail"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
  BackupError,
  DATABASE_FILE,
  FILES_FILE,
  bundledMigrationNames,
  decryptFile,
  readIdentities,
  readManifest,
  runTool,
  sha256File,
} from "./backup.ts"
import type { BackupManifest } from "./backup.ts"

export interface RestoreOptions {
  readonly path: string
  /** Replace the contents of a non-empty database and file store. */
  readonly force: boolean
  /** age identity file, required for encrypted backups. */
  readonly ageIdentityFile?: string | undefined
}

/** Trail entry for a finished restore; written before the trail check so it is covered too. */
export const backupRestored = Command.make("backup.restored", {
  input: Schema.Struct({ name: Schema.String, migrations: Schema.Number }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: (input) => record({ action: "backup.restored", details: input }),
})

export interface RestoreResult {
  readonly dir: string
  readonly manifest: BackupManifest
  readonly migrationsApplied: number
}

/** Backup directory from either the directory itself or a path to its `manifest.json`. */
const backupDir = (path: string): string =>
  basename(path) === "manifest.json" ? dirname(path) : path

const checkChecksums = async (dir: string, manifest: BackupManifest): Promise<void> => {
  const stored =
    manifest.files.driver === "local" ? [manifest.database, manifest.files] : [manifest.database]
  for (const file of stored) {
    const actual = await sha256File(join(dir, file.file))
    if (actual !== file.sha256) {
      throw new BackupError({
        message: `checksum mismatch for ${file.file}: the backup is corrupt or was modified`,
        integrity: true,
      })
    }
  }
}

/** The backup must be a prefix of this build's migrations: older is migrated forward, newer refused. */
const checkMigrations = (manifest: BackupManifest): number => {
  const bundled = bundledMigrationNames()
  const compatible =
    manifest.migrations.length <= bundled.length &&
    manifest.migrations.every((name, index) => bundled[index] === name)
  if (!compatible) {
    throw new BackupError({
      message: `backup has ${manifest.migrations.length} migrations this build does not match (this build ships ${bundled.length}); restore it with the audit version that wrote it, or a newer one`,
      integrity: true,
    })
  }
  return manifest.migrations.length
}

const TABLE_COUNT = `
  select count(*)::int as count from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'`

const wipeDatabase = async (sql: SQL): Promise<void> => {
  const schemas = await sql<{ name: string }[]>`
    select nspname as name from pg_namespace
    where nspname not like 'pg\\_%' and nspname <> 'information_schema'`
  for (const schema of schemas) {
    await sql.unsafe(`drop schema if exists "${schema.name}" cascade`)
  }
  await sql.unsafe("create schema public")
}

const ensureRoles = (sql: SQL) =>
  sql.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'audit_app') then
        create role audit_app nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'audit_retention') then
        create role audit_retention nologin;
      end if;
    end $$`)

export const restoreBackup = async (
  config: AppConfigShape,
  options: RestoreOptions,
): Promise<RestoreResult> => {
  const dir = backupDir(options.path)
  const manifest = await readManifest(dir)
  await checkChecksums(dir, manifest)
  const migrationsApplied = checkMigrations(manifest)
  const identities = manifest.encryption
    ? await readIdentities(requireIdentityFile(options.ageIdentityFile))
    : []

  const databaseUrl = Redacted.value(config.databaseUrl)
  const root = config.storage.driver === "local" ? config.storage.root : null
  const sql = new SQL(databaseUrl)
  try {
    const [row] = await sql.unsafe<{ count: number }[]>(TABLE_COUNT)
    const count = row?.count ?? 0
    const fileEntries = root === null ? [] : await readdir(root).catch(() => [])
    const populated = count > 0 || fileEntries.length > 0
    if (populated && !options.force) {
      throw new BackupError({
        message:
          "the target database or file store is not empty; restore into a fresh database, or pass --force to replace its contents",
      })
    }
    if (populated) {
      await wipeDatabase(sql)
      if (root !== null) await rm(root, { recursive: true, force: true })
    }
    await ensureRoles(sql)
  } finally {
    await sql.close()
  }

  const work = await mkdtemp(join(tmpdir(), "audit-restore-"))
  try {
    const dumpPath = await stage(dir, manifest.database.file, work, DATABASE_FILE, identities)
    await runTool(["pg_restore", "--no-owner", "--exit-on-error", "--dbname", databaseUrl], {
      stdin: dumpPath,
    })
    if (root !== null && manifest.files.driver === "local") {
      const tarPath = await stage(dir, manifest.files.file, work, FILES_FILE, identities)
      await mkdir(root, { recursive: true })
      await runTool(["tar", "-C", root, "-xf", tarPath])
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }

  await Effect.runPromise(migrateDatabase(config.databaseUrl))
  return { dir, manifest, migrationsApplied }
}

/** Returns the path to a plaintext copy of a stored file, decrypting into `work` when needed. */
const stage = async (
  dir: string,
  stored: string,
  work: string,
  plainName: string,
  identities: ReadonlyArray<string>,
): Promise<string> => {
  const source = join(dir, stored)
  if (identities.length === 0) return source
  const dest = join(work, plainName)
  await decryptFile(source, dest, identities)
  return dest
}

const requireIdentityFile = (path: string | undefined): string => {
  if (path === undefined) {
    throw new BackupError({
      message: "this backup is encrypted; pass --age-identity <file> with the age secret key",
    })
  }
  return path
}
