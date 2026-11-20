/**
 * The HMAC key of the audit trail. It is generated once, stored sealed under AUDIT_SECRET_KEY, and
 * read on every trail write and verification; rotate-secret re-seals it.
 */
import { trailKey } from "@audit/db/schema"
import { generateToken, Secrets } from "@audit/platform/crypto"
import { Db } from "@audit/platform/database"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Redacted } from "effect"

export const TRAIL_KEY_PURPOSE = "trail-key"

/** The plaintext trail key. The first call stores a freshly generated key; later calls read it. */
export const loadTrailKey = Effect.gen(function* () {
  const db = yield* Db
  const secrets = yield* Secrets
  const read = db
    .select({ ciphertext: trailKey.keyCiphertext, nonce: trailKey.keyNonce })
    .from(trailKey)
    .where(eq(trailKey.id, 1))
    .pipe(Effect.orDie)
  let [row] = yield* read
  if (row?.ciphertext == null || row.nonce == null) {
    const sealed = yield* secrets.seal(TRAIL_KEY_PURPOSE, generateToken(32))
    // Conditional, so concurrent first writers settle on the one stored key.
    yield* db
      .update(trailKey)
      .set({ keyCiphertext: sealed.ciphertext, keyNonce: sealed.nonce })
      .where(and(eq(trailKey.id, 1), isNull(trailKey.keyCiphertext)))
      .pipe(Effect.orDie)
    ;[row] = yield* read
  }
  if (row?.ciphertext == null || row.nonce == null) {
    return yield* Effect.die(new Error("trail key row is missing"))
  }
  const key = yield* secrets
    .open(TRAIL_KEY_PURPOSE, { ciphertext: row.ciphertext, nonce: row.nonce })
    .pipe(
      Effect.catchDefect(() =>
        Effect.die(
          new Error(
            "AUDIT_SECRET_KEY does not open the trail key; restore with the original secret",
          ),
        ),
      ),
    )
  return Redacted.value(key)
})
