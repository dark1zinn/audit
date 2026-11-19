/**
 * Breached-password lookup over the Have I Been Pwned range API. Only the first five hex characters
 * of the SHA-1 leave the server (k-anonymity). Lookups fail closed: an unreachable service rejects.
 */
import { workspace } from "@audit/db/schema"
import { ValidationError } from "@audit/domain/errors"
import { defaultWorkspaceSettings, type WorkspaceSettings } from "@audit/domain/identity/schema"
import { Db } from "@audit/platform/database"
import { createHash } from "node:crypto"
import { Context, Data, Effect, Layer } from "effect"

const RANGE_URL = "https://api.pwnedpasswords.com/range/"

/** The range API answered with a non-success status. */
class BreachLookupFailed extends Data.TaggedError("BreachLookupFailed")<{
  readonly status: number
}> {}

export class PasswordBreaches extends Context.Service<
  PasswordBreaches,
  {
    readonly isBreached: (password: string) => Effect.Effect<boolean, ValidationError>
  }
>()("@audit/core/PasswordBreaches") {
  static readonly live = Layer.succeed(PasswordBreaches, {
    isBreached: (password: string) => {
      const digest = createHash("sha1").update(password).digest("hex").toUpperCase()
      const prefix = digest.slice(0, 5)
      const suffix = digest.slice(5)
      return Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${RANGE_URL}${prefix}`, {
            headers: { "Add-Padding": "true" },
          })
          if (!response.ok) throw new BreachLookupFailed({ status: response.status })
          const body = await response.text()
          return body.split("\n").some((line) => line.split(":")[0]?.trim() === suffix)
        },
        catch: () =>
          new ValidationError({
            message: "Could not check the password right now. Try again shortly.",
            field: "password",
          }),
      })
    },
  })

  /** No breach lookups: every password passes. Used only where the check is turned off. */
  static readonly disabled = Layer.succeed(PasswordBreaches, {
    isBreached: () => Effect.succeed(false),
  })
}

/** Rejects a password that appears in a breach corpus, when the workspace turned the check on. */
export const assertNotBreached = (password: string, enabled: boolean) =>
  Effect.gen(function* () {
    if (!enabled) return
    const breaches = yield* PasswordBreaches
    const breached = yield* breaches.isBreached(password)
    if (breached) {
      return yield* new ValidationError({
        message: "This password appears in a known data breach. Choose another.",
        field: "password",
      })
    }
  })

/**
 * Applies the workspace's breached-password setting to a password chosen by a person (sign-up,
 * change, reset). The auth hook and the sign-up command both use this.
 */
export const assertPasswordAllowed = (password: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    const [row] = yield* db
      .select({ settings: workspace.settings })
      .from(workspace)
      .pipe(Effect.orDie)
    const settings: WorkspaceSettings = {
      ...defaultWorkspaceSettings,
      ...(row?.settings as Partial<WorkspaceSettings> | undefined),
    }
    yield* assertNotBreached(password, settings.breachedPasswordCheck === true)
  })
