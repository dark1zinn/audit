/**
 * `audit backup`: a directory holding `database.dump` (pg_dump custom format), `files.tar` (the local
 * file store), and `manifest.json` with checksums of every stored file. With recipients, both files
 * are age-encrypted and the checksums cover the encrypted bytes. S3 file stores are not archived:
 * the bucket is backed up by its provider.
 */
import * as Command from "@audit/core/command"
import { record } from "@audit/core/trail"
import type { AppConfigShape } from "@audit/platform/config"
import { migrationsFolder } from "@audit/platform/database"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { Decrypter, Encrypter } from "age-encryption"
import { SQL } from "bun"
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Data, Effect, Redacted, Schema } from "effect"
import pkg from "../package.json" with { type: "json" }

export const MANIFEST_FILE = "manifest.json"
export const DATABASE_FILE = "database.dump"
export const FILES_FILE = "files.tar"
export const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000

/** A failed backup or restore step. Integrity failures (checksum, trail, migrations) exit 2. */
export class BackupError extends Data.TaggedError("BackupError")<{
  readonly message: string
  readonly integrity?: boolean
}> {}

export interface StoredFile {
  readonly file: string
  readonly sha256: string
  readonly bytes: number
}

export interface BackupManifest {
  readonly format: 1
  readonly createdAt: string
  readonly version: string
  /** Applied migration names in order; restore needs this to be a prefix of the bundled list. */
  readonly migrations: ReadonlyArray<string>
  readonly database: StoredFile
  readonly files:
    | (StoredFile & { readonly driver: "local" })
    | { readonly driver: "s3"; readonly skipped: true }
  readonly encryption: { readonly format: "age"; readonly recipients: number } | null
}

/** Runs an external tool, streaming stdin/stdout to files when given. */
export const runTool = async (
  argv: ReadonlyArray<string>,
  io: { readonly stdin?: string; readonly stdout?: string } = {},
): Promise<void> => {
  let stderr: string
  let code: number
  try {
    const proc = Bun.spawn({
      cmd: [...argv],
      stdin: io.stdin === undefined ? "ignore" : Bun.file(io.stdin),
      stdout: io.stdout === undefined ? "ignore" : Bun.file(io.stdout),
      stderr: "pipe",
    })
    ;[stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new BackupError({ message: `cannot run ${argv[0]} (${reason})` })
  }
  if (code !== 0) {
    throw new BackupError({ message: `${argv[0]} exited with ${code}: ${stderr.trim()}` })
  }
}

export const sha256File = async (path: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest("hex")
}

/** Encrypts `source` to `dest` for every recipient (age `age1…` keys), then removes `source`. */
export const encryptFile = async (
  source: string,
  dest: string,
  recipients: ReadonlyArray<string>,
): Promise<void> => {
  const encrypter = new Encrypter()
  for (const recipient of recipients) {
    try {
      encrypter.addRecipient(recipient)
    } catch {
      throw new BackupError({ message: `not a valid age recipient: ${recipient}` })
    }
  }
  const encrypted = await encrypter.encrypt(Bun.file(source).stream())
  await Bun.write(dest, encrypted)
  await unlink(source)
}

/** Decrypts `source` to `dest` with the identities from an age identity file. */
export const decryptFile = async (
  source: string,
  dest: string,
  identities: ReadonlyArray<string>,
): Promise<void> => {
  const decrypter = new Decrypter()
  for (const identity of identities) decrypter.addIdentity(identity)
  try {
    const plain = await decrypter.decrypt(Bun.file(source).stream())
    await Bun.write(dest, plain)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new BackupError({ message: `cannot decrypt ${source} (${reason})`, integrity: true })
  }
}

/** Reads the `AGE-SECRET-KEY-…` lines of an age identity file. */
export const readIdentities = async (path: string): Promise<ReadonlyArray<string>> => {
  const lines = (await readFile(path, "utf8")).split("\n").map((line) => line.trim())
  const identities = lines.filter((line) => line.startsWith("AGE-SECRET-KEY-"))
  if (identities.length === 0) {
    throw new BackupError({ message: `no AGE-SECRET-KEY lines in ${path}` })
  }
  return identities
}

/** Where built-in backups go: `BACKUP_DIR`, else `<DATA_DIR>/backups`. */
export const backupDirectory = (config: AppConfigShape): string =>
  process.env.BACKUP_DIR ?? join(config.dataDir, "backups")

const applicationMigrations = async (databaseUrl: string): Promise<ReadonlyArray<string>> => {
  const sql = new SQL(databaseUrl)
  try {
    const rows = await sql<{ name: string }[]>`
      select name from drizzle.__drizzle_migrations order by id`
    return rows.map((row) => row.name)
  } catch {
    throw new BackupError({ message: "the database has no migrations; run `audit migrate` first" })
  } finally {
    await sql.close()
  }
}

const storedFile = async (dir: string, file: string): Promise<StoredFile> => ({
  file,
  sha256: await sha256File(join(dir, file)),
  bytes: (await stat(join(dir, file))).size,
})

export interface BackupResult {
  readonly dir: string
  readonly manifest: BackupManifest
}

/** Writes a new `audit-backup-<UTC stamp>` directory under `out`. */
export const createBackup = async (options: {
  readonly config: AppConfigShape
  readonly out: string
  readonly recipients: ReadonlyArray<string>
}): Promise<BackupResult> => {
  const { config, recipients } = options
  for (const recipient of recipients) {
    if (!recipient.startsWith("age1")) {
      throw new BackupError({ message: `not an age recipient (expected age1…): ${recipient}` })
    }
  }
  const databaseUrl = Redacted.value(config.databaseUrl)
  const migrations = await applicationMigrations(databaseUrl)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = resolve(options.out, `audit-backup-${stamp}`)
  await mkdir(dir, { recursive: true })

  await runTool(["pg_dump", "--format=custom", "--no-owner", "--dbname", databaseUrl], {
    stdout: join(dir, DATABASE_FILE),
  })
  const local = config.storage.driver === "local"
  if (config.storage.driver === "local") {
    await mkdir(config.storage.root, { recursive: true })
    await runTool(["tar", "-C", config.storage.root, "-cf", join(dir, FILES_FILE), "."])
  }

  const plainFiles = local ? [DATABASE_FILE, FILES_FILE] : [DATABASE_FILE]
  if (recipients.length > 0) {
    for (const file of plainFiles) {
      await encryptFile(join(dir, file), join(dir, `${file}.age`), recipients)
    }
  }
  const suffix = recipients.length > 0 ? ".age" : ""

  const manifest: BackupManifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    version: pkg.version,
    migrations,
    database: await storedFile(dir, `${DATABASE_FILE}${suffix}`),
    files: local
      ? { driver: "local", ...(await storedFile(dir, `${FILES_FILE}${suffix}`)) }
      : { driver: "s3", skipped: true },
    encryption: recipients.length > 0 ? { format: "age", recipients: recipients.length } : null,
  }
  await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
  return { dir, manifest }
}

export const readManifest = async (dir: string): Promise<BackupManifest> => {
  const text = await readFile(join(dir, MANIFEST_FILE), "utf8").catch(() => null)
  if (text === null) throw new BackupError({ message: `no ${MANIFEST_FILE} in ${dir}` })
  const manifest = JSON.parse(text) as BackupManifest
  if (manifest.format !== 1) {
    throw new BackupError({ message: `unsupported backup format ${String(manifest.format)}` })
  }
  return manifest
}

/** Names of the migrations this build ships, in order. */
export const bundledMigrationNames = (): ReadonlyArray<string> =>
  readMigrationFiles({ migrationsFolder }).map((migration) => migration.name)

/** Newest `createdAt` among readable backups in `dir`, or null. */
export const newestBackup = async (dir: string): Promise<Date | null> => {
  const entries = await readdir(dir).catch(() => [])
  let newest: Date | null = null
  for (const entry of entries) {
    const manifest = await readManifest(join(dir, entry)).catch(() => null)
    if (manifest === null) continue
    const created = new Date(manifest.createdAt)
    if (newest === null || created > newest) newest = created
  }
  return newest
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

/**
 * The start-up warning. It applies only when built-in backups are in use (BACKUP_DIR set, or the
 * default directory exists) and no backup there is newer than 24 h.
 */
export const staleBackupWarning = async (
  config: AppConfigShape,
  now: number = Date.now(),
): Promise<string | null> => {
  const dir = backupDirectory(config)
  const inUse = process.env.BACKUP_DIR !== undefined || (await exists(dir))
  if (!inUse) return null
  const newest = await newestBackup(dir)
  if (newest !== null && now - newest.getTime() < MAX_BACKUP_AGE_MS) return null
  const latest = newest === null ? "none found" : newest.toISOString()
  return `No backup newer than 24 h in ${dir} (latest: ${latest}). Run \`audit backup\`.`
}

/** Trail entry for a finished backup. It is written after the dump, so the dump lacks it. */
export const backupCreated = Command.make("backup.created", {
  input: Schema.Struct({
    name: Schema.String,
    migrations: Schema.Number,
    encrypted: Schema.Boolean,
  }),
  output: Schema.Void,
  authorize: () => Effect.void,
  run: (input) => record({ action: "backup.created", details: input }),
})
