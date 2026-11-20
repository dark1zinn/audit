#!/usr/bin/env bun
/**
 * `audit <command>`: the server binary's entry point.
 */
import { CurrentActor } from "@audit/domain/actor"
import { chainTrail } from "@audit/core/trail-chain"
import { verifyTrail } from "@audit/core/trail-queries"
import type { TrailHead, TrailVerification } from "@audit/domain/trail/schema"
import { rotateSecrets } from "@audit/core/admin/secret-rotation"
import { type AppConfigShape, readAppConfig } from "@audit/platform/config"
import { migrateDatabase } from "@audit/platform/database"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { makeCoreLayer, makeTrailLayer, startServer } from "./server.ts"
import { seedDemo } from "./seed-demo.ts"
import { basename } from "node:path"
import {
  BackupError,
  backupCreated,
  backupDirectory,
  createBackup,
  manifestTrailHead,
  trailChainPresent,
  trailKeyPresent,
  staleBackupWarning,
} from "./backup.ts"
import { createOwner, reembed, reindex, resetPassword, type OwnerStatus } from "./operator.ts"
import { backupRestored, restoreBackup } from "./restore.ts"

const usage = `Usage: audit <command>

Commands:
  serve                        Run migrations and start the server
  migrate                      Apply pending migrations
  create-owner --email <e> [--name <n>] [--workspace <name>]
                               Create or promote an owner; prints a one-time password link
  reset-password <email>       Print a one-time password link (works for owners too)
  reindex                      Rebuild the search index
  reembed                      Drop embeddings and queue every item for re-embedding
  backup [--out <dir>] [--age-recipient <age1…>]...
                               Write a backup of the database and file store
  restore <path> [--force] [--age-identity <file>]
                               Restore a backup (--force replaces existing data)
  seed --demo [--force]        Fill an empty workspace with demo data (--force adds to a workspace with members)
  rotate-secret --from <old>   Re-encrypt AI keys and the VAPID key from the previous AUDIT_SECRET_KEY
  trail verify                 Re-check the audit log hash chain

Exit codes: 0 ok, 1 error or refusal, 2 integrity failure (checksum, trail, migrations).`

const loadConfig = () => Effect.runPromise(readAppConfig)

const serve = async () => {
  const config = await loadConfig()
  const warning = await staleBackupWarning(config)
  if (warning !== null) console.warn(`WARN ${warning}`)
  const running = await startServer(config)
  console.log(`audit listening on ${running.server.url} (public URL ${config.url.origin})`)
  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    console.log(`${signal}: shutting down`)
    const timer = setTimeout(() => process.exit(1), 30_000)
    await running.stop()
    clearTimeout(timer)
    process.exit(0)
  }
  process.once("SIGINT", () => void shutdown("SIGINT"))
  process.once("SIGTERM", () => void shutdown("SIGTERM"))
}

const parseHead = (value: string | undefined): TrailHead | undefined => {
  if (value === undefined) return undefined
  const [position, hash] = value.split(":")
  const n = Number(position)
  if (!Number.isInteger(n) || n < 0 || !hash)
    throw new Error("--head expects <chain position>:<hash>")
  return { chainPos: n, hash }
}

const describeVerdict = (verdict: TrailVerification): string => {
  if (verdict.ok) {
    // Recent entries wait for the server's chainer; they are checked once chained.
    const pending = verdict.pending > 0 ? ` ${verdict.pending} recent entries not chained yet.` : ""
    return `Audit log intact: ${verdict.checked} entries checked.${pending}`
  }
  if (verdict.expectedHeadFound === false)
    return `Audit log does not contain the expected head: its tail was removed (${verdict.checked} entries checked).`
  if (verdict.firstBrokenPos !== null)
    return `Audit log BROKEN at chain position ${verdict.firstBrokenPos} (${verdict.checked} entries checked).`
  return `Audit log has ${verdict.overdue} committed entries not chained (${verdict.pending} pending): the trail chainer is not running.`
}

const verify = async () => {
  const config = await loadConfig()
  const expectedHead = parseHead(flagValue("--head"))
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  const result = await runtime.runPromise(
    verifyTrail(expectedHead === undefined ? {} : { expectedHead }).pipe(
      Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
      Effect.orDie,
    ),
  )
  await runtime.dispose()
  console.log(describeVerdict(result))
  process.exit(result.ok ? 0 : 2)
}

const seed = async (force: boolean) => {
  const config = await loadConfig()
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  try {
    await runtime.runPromise(
      seedDemo({ force }).pipe(
        Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
        Effect.orDie,
      ),
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    await runtime.dispose()
  }
}

const rotateSecret = async (from: string | undefined) => {
  if (from === undefined || from.length === 0) {
    console.error("rotate-secret needs --from <previous AUDIT_SECRET_KEY>")
    process.exitCode = 1
    return
  }
  const config = await loadConfig()
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  try {
    const result = await runtime.runPromise(
      rotateSecrets(Redacted.make(from))
        .execute({})
        .pipe(Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" })),
    )
    console.log(
      `Re-encrypted ${result.aiKeys} AI provider key(s); VAPID key ${result.vapid ? "re-encrypted" : "not set"}.`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    await runtime.dispose()
  }
}

const args = process.argv.slice(2)
const [command, sub] = args

const flagValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const flagValues = (name: string): string[] =>
  args.flatMap((arg, index) => {
    const value = args[index + 1]
    return arg === name && value !== undefined ? [value] : []
  })

const fail = (message: string, code = 1): void => {
  console.error(message)
  process.exitCode = code
}

/** Runs a one-shot command, then exits: the database pool keeps the process alive otherwise. */
const reportErrors = async (run: () => Promise<void>) => {
  try {
    await run()
  } catch (error) {
    if (error instanceof BackupError) fail(error.message, error.integrity ? 2 : 1)
    else fail(error instanceof Error ? error.message : String(error))
  }
  process.exit(process.exitCode ?? 0)
}

const ownerMessages: Record<OwnerStatus, string> = {
  setup: "workspace created",
  created: "owner account created",
  promoted: "existing member promoted to owner",
  unchanged: "already an owner",
}

const createOwnerCommand = async () => {
  const email = flagValue("--email")
  if (email === undefined) return fail("create-owner needs --email <address>")
  const config = await loadConfig()
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  try {
    const owner = await runtime.runPromise(
      createOwner({
        email,
        name: flagValue("--name") ?? email.split("@")[0] ?? email,
        workspaceName: flagValue("--workspace") ?? "Workspace",
      }).pipe(Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }), Effect.orDie),
    )
    console.log(`${owner.email}: ${ownerMessages[owner.status]}.`)
    console.log(`Set the password with this one-time link (valid 24 h):\n${owner.url}`)
  } finally {
    await runtime.dispose()
  }
}

const resetPasswordCommand = async (email: string | undefined) => {
  if (email === undefined)
    return fail("reset-password needs an email: audit reset-password <email>")
  const config = await loadConfig()
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  try {
    const link = await runtime.runPromise(
      resetPassword(email).pipe(
        Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
        Effect.orDie,
      ),
    )
    if (link === null) return fail(`No account with email ${email}`)
    console.log(`One-time password link for ${link.email} (valid 24 h):\n${link.url}`)
  } finally {
    await runtime.dispose()
  }
}

const reindexCommand = async () => {
  const config = await loadConfig()
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  try {
    const result = await runtime.runPromise(
      reindex.pipe(
        Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
        Effect.orDie,
      ),
    )
    console.log(`Reindexed ${result.updated} search entries.`)
  } finally {
    await runtime.dispose()
  }
}

const reembedCommand = async () => {
  const config = await loadConfig()
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  try {
    const result = await runtime.runPromise(
      reembed.pipe(
        Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
        Effect.orDie,
      ),
    )
    console.log(`Queued ${result.queued} embedding job(s); the running server processes them.`)
  } finally {
    await runtime.dispose()
  }
}

/**
 * Chains committed trail entries without the job runner: a runtime that starts it registers a
 * row in pgboss.instance, which would make a backup or restore differ from its source.
 */
const chainCommitted = async (config: AppConfigShape) => {
  const runtime = ManagedRuntime.make(makeTrailLayer(config).pipe(Layer.orDie))
  try {
    await runtime.runPromise(chainTrail.pipe(Effect.orDie))
  } finally {
    await runtime.dispose()
  }
}

const backupCommand = async () => {
  const config = await loadConfig()
  const recipients = flagValues("--age-recipient")
  const databaseUrl = Redacted.value(config.databaseMigratorUrl)
  // Chain committed entries first, so the dump holds the head the manifest records.
  const chained = await trailChainPresent(databaseUrl)
  if (chained) await chainCommitted(config)
  const result = await createBackup({
    config,
    out: flagValue("--out") ?? backupDirectory(config),
    recipients,
  })
  if (chained && (await trailKeyPresent(databaseUrl))) {
    const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
    try {
      await runtime.runPromise(
        backupCreated
          .execute({
            name: basename(result.dir),
            migrations: result.manifest.migrations.length,
            encrypted: recipients.length > 0,
          })
          .pipe(
            Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
            Effect.orDie,
          ),
      )
    } finally {
      await runtime.dispose()
    }
  } else {
    console.warn(
      `Backup not recorded in the audit trail: the schema predates the chained trail. Run \`audit migrate\` with this build, then back up again to record it.`,
    )
  }
  const encrypted = recipients.length > 0 ? ", age-encrypted" : ""
  console.log(
    `Backup written to ${result.dir} (${result.manifest.migrations.length} migrations${encrypted}).`,
  )
}

const restoreCommand = async (path: string | undefined) => {
  if (path === undefined) throw new Error("restore needs a backup path: audit restore <path>")
  const config = await loadConfig()
  const result = await restoreBackup(config, {
    path,
    force: args.includes("--force"),
    ageIdentityFile: flagValue("--age-identity"),
  })
  // The dump can hold committed entries the chainer had not reached yet; chain them first.
  await chainCommitted(config)
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  try {
    const expectedHead = manifestTrailHead(result.manifest) ?? undefined
    const verdict = await runtime.runPromise(
      verifyTrail(expectedHead === undefined ? {} : { expectedHead }).pipe(
        Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
        Effect.orDie,
      ),
    )
    if (!verdict.ok) {
      console.error(`Restore refused, backup not recorded: ${describeVerdict(verdict)}`)
      process.exitCode = 2
      return
    }
    await runtime.runPromise(
      backupRestored
        .execute({ name: basename(result.dir), migrations: result.migrationsApplied })
        .pipe(Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }), Effect.orDie),
    )
    console.log(
      `Restored ${result.dir}: backup had ${result.migrationsApplied} migrations, migrated to this build.`,
    )
    console.log(describeVerdict(verdict))
  } finally {
    await runtime.dispose()
  }
}
switch (command) {
  case "serve":
    await serve()
    break
  case "migrate": {
    const config = await loadConfig()
    await Effect.runPromise(migrateDatabase(config.databaseMigratorUrl))
    console.log("Migrations applied.")
    break
  }
  case "trail":
    if (sub === "verify") await verify()
    else console.log(usage)
    break
  case "seed":
    if (sub === "--demo") await reportErrors(() => seed(process.argv.includes("--force")))
    else console.log(usage)
    break
  case "rotate-secret": {
    const index = process.argv.indexOf("--from")
    await reportErrors(() => rotateSecret(index === -1 ? undefined : process.argv[index + 1]))
    break
  }
  case "create-owner":
    await reportErrors(createOwnerCommand)
    break
  case "reset-password":
    await reportErrors(() => resetPasswordCommand(sub))
    break
  case "reindex":
    await reportErrors(reindexCommand)
    break
  case "reembed":
    await reportErrors(reembedCommand)
    break
  case "backup":
    await reportErrors(backupCommand)
    break
  case "restore":
    await reportErrors(() => restoreCommand(sub))
    break
  default:
    console.log(usage)
    process.exit(command === undefined || command === "help" ? 0 : 1)
}
