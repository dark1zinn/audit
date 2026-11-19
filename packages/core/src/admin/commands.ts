/**
 * Admin writes: security and sign-up policy, branding, retention windows, the email test, and the
 * workspace export. All need `workspace.settings` (owner or admin) except where noted.
 */
import { files, workspace, workspaceMembers, entities, user } from "@audit/db/schema"
import { actorUserId, CurrentActor } from "@audit/domain/actor"
import { ValidationError } from "@audit/domain/errors"
import { defaultWorkspaceSettings, type WorkspaceSettings } from "@audit/domain/identity/schema"
import {
  BrandingInput,
  EmailTestInput,
  OrphanCleanupResult,
  RetentionInput,
  SecurityInput,
} from "@audit/domain/admin/schema"
import type { FileId } from "@audit/domain/ids"
import { FileRef } from "@audit/domain/files/schema"
import { Db } from "@audit/platform/database"
import { BlobStore } from "@audit/platform/blob-store"
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm"
import { Effect, Option, Schema, Stream } from "effect"
import * as Command from "../command.ts"
import { Authz } from "../authz.ts"
import { Mailer } from "../notifications/mail.ts"
import { cleanupOrphanedFiles } from "../files/cleanup.ts"
import { currentUser } from "../current-user.ts"
import { createEntity } from "../entities.ts"
import { cleanFileName, sha256Hex, sniffMime } from "../files/media.ts"
import { fileLimits } from "../files/queries.ts"
import { emit, record } from "../trail.ts"

/** The workspace settings JSON as stored, including the internal `vapid` key. */
const storedSettings = Effect.gen(function* () {
  const db = yield* Db
  const [row] = yield* db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, 1))
    .pipe(Effect.orDie)
  return (row?.settings ?? {}) as Record<string, unknown>
})

/** Writes settings back, keeping every key the caller did not change (`vapid` included). */
const saveSettings = (
  settings: Record<string, unknown>,
  columns: Partial<{
    name: string
    logoFileId: string
    signupPolicy: { mode: "closed" | "domains"; domains: string[] }
  }>,
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db
      .update(workspace)
      .set({ ...columns, settings: settings as WorkspaceSettings, updatedAt: new Date() })
      .where(eq(workspace.id, 1))
      .pipe(Effect.orDie)
  })

const requireSettings = () =>
  Effect.gen(function* () {
    const authz = yield* Authz
    yield* authz.requireCapability("workspace.settings")
  })

export const updateSecurity = Command.make("admin.updateSecurity", {
  input: SecurityInput,
  output: SecurityInput,
  authorize: () => requireSettings(),
  run: (input) =>
    Effect.gen(function* () {
      const stored = yield* storedSettings
      yield* saveSettings(
        { ...stored, breachedPasswordCheck: input.breachedPasswordCheck },
        {
          signupPolicy: { mode: input.signupPolicy.mode, domains: [...input.signupPolicy.domains] },
        },
      )
      yield* record({
        action: "admin.security_updated",
        details: {
          signupMode: input.signupPolicy.mode,
          signupDomains: input.signupPolicy.domains,
          breachedPasswordCheck: input.breachedPasswordCheck,
        },
      })
      return input
    }),
})

export const updateBranding = Command.make("admin.updateBranding", {
  input: BrandingInput,
  output: BrandingInput,
  authorize: () => requireSettings(),
  run: (input) =>
    Effect.gen(function* () {
      const stored = yield* storedSettings
      yield* saveSettings(
        {
          ...stored,
          accentColor: input.accentColor,
          defaultTheme: input.defaultTheme,
        },
        {
          name: input.name,
          ...(input.logoFileId === undefined ? {} : { logoFileId: input.logoFileId }),
        },
      )
      yield* record({
        action: "workspace.branding_updated",
        details: {
          name: input.name,
          logoFileId: input.logoFileId ?? null,
          accentColor: input.accentColor,
          defaultTheme: input.defaultTheme,
        },
      })
      yield* emit({
        _tag: "WorkspaceUpdated",
        entityId: null,
        projectId: null,
        actorId: actorUserId(yield* CurrentActor),
        version: null,
      })
      return input
    }),
})

export const updateRetention = Command.make("admin.updateRetention", {
  input: RetentionInput,
  output: RetentionInput,
  authorize: () => requireSettings(),
  run: (input) =>
    Effect.gen(function* () {
      const stored = yield* storedSettings
      yield* saveSettings(
        {
          ...stored,
          trailRetentionDays: input.trailRetentionDays,
          softDeleteRetentionDays: input.softDeleteRetentionDays,
        },
        {},
      )
      yield* record({
        action: "admin.retention_updated",
        details: {
          trailRetentionDays: input.trailRetentionDays,
          softDeleteRetentionDays: input.softDeleteRetentionDays,
        },
      })
      return input
    }),
})

export const sendEmailTest = Command.make("admin.emailTest", {
  input: EmailTestInput,
  output: EmailTestInput,
  authorize: () => requireSettings(),
  run: (input) =>
    Effect.gen(function* () {
      const mailer = yield* Mailer
      if (!mailer.enabled) {
        return yield* new ValidationError({ message: "Email is not configured on this server" })
      }
      yield* mailer
        .send({
          to: input.to,
          subject: "Audit: test email",
          text: "This is a test message from your workspace admin console. Email delivery works.",
        })
        .pipe(
          Effect.catch(() =>
            Effect.fail(new ValidationError({ message: "The test email could not be sent" })),
          ),
        )
      yield* record({ action: "email.test_sent", details: {} })
      return input
    }),
})

/** Keys of the settings JSON an export may carry; the `vapid` private key never leaves the server. */
const exportedSettingKeys = Object.keys(defaultWorkspaceSettings)

/** Records the export. The rows come from `workspaceExport`, which the route streams after this. */
export const exportWorkspace = Command.make("admin.exportWorkspace", {
  input: Schema.Struct({}),
  output: Schema.Void,
  authorize: () => requireSettings(),
  run: () => record({ action: "workspace.exported" }),
})

const EXPORT_PAGE_SIZE = 500
const jsonLine = (value: object) => `${JSON.stringify(value)}\n`

/**
 * The workspace as JSON Lines: one settings line, one line per member, then every visible entity
 * in id order, read a page at a time. Checks `workspace.settings` itself.
 */
export const workspaceExport = Effect.gen(function* () {
  yield* requireSettings()
  const authz = yield* Authz
  const db = yield* Db

  const [ws] = yield* db
    .select({ name: workspace.name, settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, 1))
    .pipe(Effect.orDie)
  const stored = (ws?.settings ?? {}) as Record<string, unknown>
  const settings = Object.fromEntries(exportedSettingKeys.map((key) => [key, stored[key]]))

  const members = yield* db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .pipe(Effect.orDie)

  const visible = yield* authz.visible(sql`${entities.id}`)
  const header = Stream.make(jsonLine({ record: "workspace", name: ws?.name, settings }))
  const memberLines = Stream.fromIterable(members).pipe(
    Stream.map((member) => jsonLine({ record: "member", ...member })),
  )
  const entityLines = Stream.paginate(null as string | null, (after) =>
    db
      .select({
        id: entities.id,
        type: entities.type,
        title: entities.title,
        projectId: entities.projectId,
        parentId: entities.parentId,
        createdBy: entities.createdBy,
      })
      .from(entities)
      .where(
        and(
          isNull(entities.deletedAt),
          visible,
          after === null ? undefined : gt(entities.id, after),
        ),
      )
      .orderBy(asc(entities.id))
      .limit(EXPORT_PAGE_SIZE)
      .pipe(
        Effect.orDie,
        Effect.map((rows) => {
          const last = rows.at(-1)
          const next =
            rows.length < EXPORT_PAGE_SIZE || last === undefined
              ? Option.none()
              : Option.some(last.id)
          return [rows.map((row) => jsonLine({ record: "entity", ...row })), next] as const
        }),
      ),
  )
  const encoder = new TextEncoder()
  return header.pipe(
    Stream.concat(memberLines),
    Stream.concat(entityLines),
    Stream.map((text) => encoder.encode(text)),
  )
})

export const runOrphanCleanup = Command.make("admin.runOrphanCleanup", {
  input: Schema.Struct({}),
  output: OrphanCleanupResult,
  authorize: () => requireSettings(),
  run: () =>
    Effect.gen(function* () {
      // A system job: the admin's rights over each file's owner must not decide what gets purged.
      const result = yield* cleanupOrphanedFiles.pipe(
        Effect.provideService(CurrentActor, { _tag: "system", reason: "orphan-cleanup" } as const),
        Effect.orDie,
      )
      yield* record({ action: "admin.orphan_cleanup_ran", details: { purged: result.purged } })
      return result
    }),
})

/** Largest logo accepted; the route allows multipart framing on top. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_MIMES: ReadonlyArray<string> = ["image/png", "image/jpeg", "image/webp"]

/**
 * Stores the workspace logo as a file with no parent, then points `workspace.logoFileId` at it.
 * Only PNG, JPEG and WebP are accepted; the MIME type is sniffed from the bytes.
 */
export const uploadLogo = Command.make("admin.uploadLogo", {
  input: Schema.Struct({ name: Schema.String, bytes: Schema.Uint8Array }),
  output: FileRef,
  authorize: () => requireSettings(),
  run: (input) =>
    Effect.gen(function* () {
      const db = yield* Db
      const blobs = yield* BlobStore
      const userId = yield* currentUser("admin.uploadLogo")
      const size = input.bytes.byteLength
      if (size === 0) {
        return yield* new ValidationError({ message: "The logo is empty", field: "file" })
      }
      if (size > LOGO_MAX_BYTES) {
        return yield* new ValidationError({
          message: "The logo is larger than 2 MB",
          field: "file",
        })
      }
      const limits = yield* fileLimits
      if (limits.usedBytes + size > limits.quotaBytes) {
        return yield* new ValidationError({
          message: "The workspace storage quota is full",
          field: "file",
        })
      }
      const mime = yield* Effect.promise(() => sniffMime(input.bytes))
      if (!LOGO_MIMES.includes(mime)) {
        return yield* new ValidationError({
          message: "The logo must be a PNG, JPEG or WebP image",
          field: "file",
        })
      }

      const name = cleanFileName(input.name)
      const sha256 = sha256Hex(input.bytes)
      const id = Bun.randomUUIDv7() as FileId
      const storageKey = `originals/${id}`

      // Blob first, as uploadFile does: a failed insert leaves an unreferenced blob, not a dangling row.
      yield* blobs.put(storageKey, input.bytes).pipe(Effect.orDie)
      yield* createEntity({
        id,
        type: "file",
        title: name,
        searchText: name,
        parentId: null,
        projectId: null,
      })
      yield* db
        .insert(files)
        .values({
          id,
          storageKey,
          thumbnailKey: null,
          name,
          mime,
          size,
          sha256,
          uploadedBy: userId,
          scanStatus: "skipped",
        })
        .pipe(Effect.orDie)
      yield* db
        .update(workspace)
        .set({ logoFileId: id, updatedAt: new Date() })
        .where(eq(workspace.id, 1))
        .pipe(Effect.orDie)
      yield* record({
        action: "workspace.branding_updated",
        entityId: id,
        entityType: "file",
        projectId: null,
        details: { logoFileId: id, name, mime, size },
      })
      return { id, name, mime, size, url: `/files/${id}`, thumbnailUrl: null }
    }),
})
