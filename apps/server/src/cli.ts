#!/usr/bin/env bun
/**
 * `audit <command>`: the server binary's entry point.
 */
import { CurrentActor } from "@audit/domain/actor"
import { verifyTrail } from "@audit/core/trail-queries"
import { readAppConfig } from "@audit/platform/config"
import { migrateDatabase } from "@audit/platform/database"
import { Effect, Layer, ManagedRuntime } from "effect"
import { makeCoreLayer, startServer } from "./server.ts"

const usage = `Usage: audit <command>

Commands:
  serve          Run migrations and start the server
  migrate        Apply pending database migrations
  trail verify   Re-check the audit log hash chain`

const loadConfig = () => Effect.runPromise(readAppConfig)

const serve = async () => {
  const config = await loadConfig()
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

const verify = async () => {
  const config = await loadConfig()
  const runtime = ManagedRuntime.make(makeCoreLayer(config).pipe(Layer.orDie))
  const result = await runtime.runPromise(
    verifyTrail.pipe(
      Effect.provideService(CurrentActor, { _tag: "system", reason: "cli" }),
      Effect.orDie,
    ),
  )
  await runtime.dispose()
  console.log(
    result.ok
      ? `Audit log intact: ${result.checked} entries checked.`
      : `Audit log BROKEN at seq ${result.firstBrokenSeq} (${result.checked} entries checked).`,
  )
  process.exit(result.ok ? 0 : 2)
}

const [command, sub] = process.argv.slice(2)
switch (command) {
  case "serve":
    await serve()
    break
  case "migrate": {
    const config = await loadConfig()
    await Effect.runPromise(migrateDatabase(config.databaseUrl))
    console.log("Migrations applied.")
    break
  }
  case "trail":
    if (sub === "verify") await verify()
    else console.log(usage)
    break
  default:
    console.log(usage)
    process.exit(command === undefined || command === "help" ? 0 : 1)
}
