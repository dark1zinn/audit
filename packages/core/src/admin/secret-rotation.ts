/**
 * Re-encrypts every value sealed under the previous AUDIT_SECRET_KEY with the current one: AI
 * provider keys (purpose `ai-key`) and the workspace VAPID private key (purpose `vapid`). One
 * command, so one transaction: either every sealed value moves to the new key or none does.
 */
import { aiProviders, trailKey, workspace } from "@audit/db/schema"
import { ValidationError } from "@audit/domain/errors"
import { CurrentActor } from "@audit/domain/actor"
import { type Sealed, Secrets, type SecretsShape, makeSecrets } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { Effect, Redacted, Schema } from "effect"
import * as Command from "../command.ts"
import { record } from "../trail.ts"
import { TRAIL_KEY_PURPOSE } from "../trail-key.ts"

const AI_KEY_PURPOSE = "ai-key"
const VAPID_PURPOSE = "vapid"

const requireSystem = Effect.gen(function* () {
  const actor = yield* CurrentActor
  if (actor._tag !== "system") {
    return yield* new ValidationError({ message: "Secret rotation runs from the server CLI only" })
  }
})

/** Opens with the old key and reseals with the current one; a wrong old key fails clearly. */
const reseal = (
  old: SecretsShape,
  current: SecretsShape,
  purpose: string,
  sealed: Sealed,
  what: string,
) =>
  Effect.gen(function* () {
    const plaintext = yield* old.open(purpose, sealed).pipe(
      Effect.catchDefect(() =>
        Effect.fail(
          new ValidationError({
            message: `Could not open the ${what} with the previous secret; check --from`,
          }),
        ),
      ),
    )
    return yield* current.seal(purpose, Redacted.value(plaintext))
  })

/** Rotates every sealed value from `previous` to the current AUDIT_SECRET_KEY. */
export const rotateSecrets = (previous: Redacted.Redacted<string>) =>
  Command.make("secrets.rotate", {
    input: Schema.Struct({}),
    output: Schema.Struct({ aiKeys: Schema.Number, vapid: Schema.Boolean }),
    authorize: () => requireSystem,
    run: () =>
      Effect.gen(function* () {
        const db = yield* Db
        const current = yield* Secrets
        const old = makeSecrets(previous)

        const keys = yield* db
          .select({
            id: aiProviders.id,
            ciphertext: aiProviders.keyCiphertext,
            nonce: aiProviders.keyNonce,
          })
          .from(aiProviders)
          .where(and(isNotNull(aiProviders.keyCiphertext), isNotNull(aiProviders.keyNonce)))
          .pipe(Effect.orDie)
        for (const key of keys) {
          const sealed = yield* reseal(
            old,
            current,
            AI_KEY_PURPOSE,
            { ciphertext: key.ciphertext ?? "", nonce: key.nonce ?? "" },
            "AI provider key",
          )
          yield* db
            .update(aiProviders)
            .set({ keyCiphertext: sealed.ciphertext, keyNonce: sealed.nonce })
            .where(eq(aiProviders.id, key.id))
            .pipe(Effect.orDie)
        }

        // The trail HMAC key is sealed like the other values; a null key is generated later under
        // the current secret, so there is nothing to move.
        const [trailKeyRow] = yield* db
          .select({ ciphertext: trailKey.keyCiphertext, nonce: trailKey.keyNonce })
          .from(trailKey)
          .where(eq(trailKey.id, 1))
          .pipe(Effect.orDie)
        if (trailKeyRow?.ciphertext != null && trailKeyRow.nonce != null) {
          const sealed = yield* reseal(
            old,
            current,
            TRAIL_KEY_PURPOSE,
            { ciphertext: trailKeyRow.ciphertext, nonce: trailKeyRow.nonce },
            "trail key",
          )
          yield* db
            .update(trailKey)
            .set({ keyCiphertext: sealed.ciphertext, keyNonce: sealed.nonce })
            .where(eq(trailKey.id, 1))
            .pipe(Effect.orDie)
        }

        const [row] = yield* db
          .select({ settings: workspace.settings })
          .from(workspace)
          .where(eq(workspace.id, 1))
          .pipe(Effect.orDie)
        const stored = (
          row?.settings as
            | { readonly vapid?: { readonly publicKey: string; readonly sealed: Sealed } }
            | undefined
        )?.vapid
        let vapid = false
        if (stored !== undefined) {
          const sealed = yield* reseal(
            old,
            current,
            VAPID_PURPOSE,
            stored.sealed,
            "VAPID private key",
          )
          const value = { publicKey: stored.publicKey, sealed }
          yield* db
            .update(workspace)
            .set({
              settings: sql`jsonb_set(${workspace.settings}, '{vapid}', ${JSON.stringify(value)}::jsonb)`,
            })
            .where(eq(workspace.id, 1))
            .pipe(Effect.orDie)
          vapid = true
        }

        yield* record({
          action: "secret.rotated",
          details: { aiKeys: keys.length, vapid },
        })
        return { aiKeys: keys.length, vapid }
      }),
  })
