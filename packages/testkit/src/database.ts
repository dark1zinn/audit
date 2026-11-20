/**
 * A fresh, migrated database per test file, so suites run in parallel without sharing state.
 */
import { AiModels } from "@audit/core/ai/models"
import { Authz } from "@audit/core/authz"
import { AiUnavailable } from "@audit/domain/ai/errors"
import { EventBus } from "@audit/core/event-bus"
import { type MailMessage, Mailer } from "@audit/core/notifications/mail"
import { PasswordBreaches } from "@audit/core/admin/passwords"
import { type PostFn, PushTransport } from "@audit/core/notifications/push"
import type { Resolve } from "@audit/platform/address"
import { vapidConfig } from "@audit/core/notifications/vapid"
import type { AppConfigShape } from "@audit/platform/config"
import { AppConfig } from "@audit/platform/config"
import { BlobStore } from "@audit/platform/blob-store"
import { Secrets } from "@audit/platform/crypto"
import { APP_ROLE, databaseLayer, type Db, migrateDatabase } from "@audit/platform/database"
import { type Jobs, type RecordingJobs, recordingJobs } from "@audit/platform/jobs"
import type { SqlClient } from "effect/sql"
import { SQL } from "bun"
import * as EmbeddingModel from "effect/ai/EmbeddingModel"
import * as LanguageModel from "effect/ai/LanguageModel"
import { Effect, Layer, ManagedRuntime, Option, Redacted } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const adminUrl = process.env.TEST_DATABASE_URL ?? "postgres://audit:audit@127.0.0.1:5432/audit"

export const testConfig = (databaseUrl: string, dataDir: string): AppConfigShape => ({
  url: new URL("http://localhost:3000"),
  port: 0,
  databaseUrl: Redacted.make(databaseUrl),
  databaseMigratorUrl: Redacted.make(databaseUrl),
  secretKey: Redacted.make("test-secret-key-0123456789abcdef-0123456789"),
  setupToken: Option.none(),
  smtpUrl: Option.none(),
  mailFrom: Option.none(),
  vapidPublicKey: Option.none(),
  vapidPrivateKey: Option.none(),
  vapidSubject: Option.none(),
  storage: { driver: "local", root: join(dataDir, "files") },
  dataDir,
  trustProxy: false,
  trustProxyHops: 1,
  signInPerIpPerMinute: 30,
  aiAllowPrivateBaseUrl: false,
  logLevel: "warn",
  otelEndpoint: Option.none(),
  webDist: dataDir,
})

/** Everything commands and queries need, as in the server. */
export type TestServices =
  | AppConfig
  | Db
  | SqlClient.SqlClient
  | Authz
  | EventBus
  | BlobStore
  | Secrets
  | Jobs
  | Mailer
  | PasswordBreaches
  | PushTransport
  | AiModels

const noModels = new AiUnavailable({ message: "No AI provider in tests" })

export interface PushRequest {
  readonly url: string
  readonly init: RequestInit
}

/** The stubbed push service: records every request and answers with `status`. */
export interface PushStub {
  readonly requests: PushRequest[]
  status: number
  /** Addresses a host resolves to; hosts not listed resolve to a public documentation address. */
  readonly addresses: Map<string, string[]>
}

export interface TestDatabase {
  readonly runtime: ManagedRuntime.ManagedRuntime<TestServices, never>
  readonly jobs: RecordingJobs
  readonly config: AppConfigShape
  /** Every email the app sent, in order. */
  readonly mail: MailMessage[]
  readonly push: PushStub
  /** Passwords the breach check reports as breached; tests add to it. */
  readonly breachedPasswords: Set<string>
  /** Login-role connection for fixtures and assertions that bypass the app role. */
  readonly superuser: SQL
  readonly drop: () => Promise<void>
}

/**
 * Creates and migrates a database, returning a runtime with the core services over it. Web push
 * uses the real lazily generated VAPID keys; only the HTTP boundary is stubbed.
 */
export const makeTestDatabase = async (): Promise<TestDatabase> => {
  const name = `audit_test_${Bun.randomUUIDv7().replaceAll("-", "")}`
  const admin = new SQL(adminUrl)
  await admin.unsafe(`create database ${name}`)
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const databaseUrl = url.toString()
  await Effect.runPromise(migrateDatabase(Redacted.make(databaseUrl)))

  const dataDir = await mkdtemp(join(tmpdir(), "audit-test-"))
  const config = testConfig(databaseUrl, dataDir)
  const jobs = recordingJobs()
  const mail: MailMessage[] = []
  const push: PushStub = { requests: [], status: 201, addresses: new Map() }
  const breachedPasswords = new Set<string>()
  const post: PostFn = async (url, init) => {
    push.requests.push({ url, init })
    return new Response(null, { status: push.status })
  }
  const resolve: Resolve = async (hostname) => push.addresses.get(hostname) ?? ["203.0.113.10"]
  const base = Layer.mergeAll(
    Layer.succeed(AppConfig, config),
    databaseLayer({ url: config.databaseUrl, role: APP_ROLE, maxConnections: 4 }),
  )
  const layer = Layer.mergeAll(
    Authz.layer,
    EventBus.layer,
    BlobStore.layer,
    Secrets.layer,
    jobs.layer,
    Mailer.recording(mail),
    Layer.succeed(PasswordBreaches, {
      isBreached: (password) => Effect.succeed(breachedPasswords.has(password)),
    }),
    PushTransport.live(vapidConfig, post, resolve).pipe(Layer.provide(Secrets.layer)),
    // No provider is reachable from tests; AI tests provide fake models explicitly.
    Layer.succeed(AiModels, {
      language: () => Layer.effect(LanguageModel.LanguageModel, Effect.fail(noModels)),
      embedding: () => Layer.effect(EmbeddingModel.EmbeddingModel, Effect.fail(noModels)),
    }),
  ).pipe(Layer.provideMerge(base))
  const runtime = ManagedRuntime.make(layer.pipe(Layer.orDie))

  const superuser = new SQL(databaseUrl)
  return {
    runtime,
    jobs,
    config,
    mail,
    push,
    breachedPasswords,
    superuser,
    drop: async () => {
      await runtime.dispose()
      await superuser.close()
      await admin.unsafe(`drop database if exists ${name} with (force)`)
      await admin.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}
