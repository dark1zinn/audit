/**
 * VAPID keys for Web Push. `VAPID_*` env wins when all three are set. Otherwise a P-256 pair is
 * generated on first use and stored in `workspace.settings.vapid`, with the private half sealed.
 * The store is conditional, so concurrent first uses converge on one key pair.
 */
import { workspace } from "@audit/db/schema"
import { AppConfig } from "@audit/platform/config"
import { type Sealed, Secrets } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { eq, sql } from "drizzle-orm"
import { Effect, Option, Redacted } from "effect"
import type { VapidConfig } from "./push.ts"

const PURPOSE = "vapid"

interface StoredVapid {
  readonly publicKey: string
  readonly sealed: Sealed
}

const generatePair = Effect.promise(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
  if (jwk.d === undefined) throw new Error("VAPID private key export failed")
  return { publicKey: Buffer.from(raw).toString("base64url"), privateKey: jwk.d }
})

const readStored = Effect.gen(function* () {
  const db = yield* Db
  const [row] = yield* db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, 1))
    .pipe(Effect.orDie)
  return (row?.settings as { readonly vapid?: StoredVapid } | undefined)?.vapid
})

const openStored = (stored: StoredVapid, subject: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const privateKey = yield* secrets.open(PURPOSE, stored.sealed)
    return {
      publicKey: stored.publicKey,
      privateKey: Redacted.value(privateKey),
      subject,
    } satisfies VapidConfig
  })

/** The VAPID configuration for this workspace; generated and persisted on first use. */
export const vapidConfig: Effect.Effect<VapidConfig, never, AppConfig | Db | Secrets> = Effect.gen(
  function* () {
    const config = yield* AppConfig
    const subject = config.url.origin
    if (Option.isSome(config.vapidPublicKey) && Option.isSome(config.vapidPrivateKey)) {
      return {
        publicKey: config.vapidPublicKey.value,
        privateKey: Redacted.value(config.vapidPrivateKey.value),
        subject: config.vapidSubject.pipe(Option.getOrElse(() => subject)),
      } satisfies VapidConfig
    }
    const existing = yield* readStored
    if (existing !== undefined) return yield* openStored(existing, subject)

    const pair = yield* generatePair
    const secrets = yield* Secrets
    const sealed = yield* secrets.seal(PURPOSE, pair.privateKey)
    const value: StoredVapid = { publicKey: pair.publicKey, sealed }
    const db = yield* Db
    yield* db
      .update(workspace)
      .set({
        settings: sql`jsonb_set(${workspace.settings}, '{vapid}', ${JSON.stringify(value)}::jsonb)`,
      })
      .where(sql`not (${workspace.settings} ? 'vapid')`)
      .pipe(Effect.orDie)
    const stored = yield* readStored
    if (stored === undefined) return yield* Effect.die(new Error("VAPID keys were not persisted"))
    return yield* openStored(stored, subject)
  },
)
