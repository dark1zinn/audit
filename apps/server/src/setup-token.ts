/**
 * First-run protection: until the workspace exists, claiming it needs a one-time token, either
 * SETUP_TOKEN from the environment or one generated and logged at start. It is destroyed after use.
 */
import { setupStatus } from "@audit/core/identity/queries"
import { AppConfig } from "@audit/platform/config"
import { generateToken } from "@audit/platform/crypto"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { timingSafeEqual } from "node:crypto"

export interface SetupTokenShape {
  readonly matches: (candidate: string) => Effect.Effect<boolean>
  readonly destroy: Effect.Effect<void>
}

export class SetupToken extends Context.Service<SetupToken, SetupTokenShape>()(
  "@audit/server/SetupToken",
) {
  static readonly layer = Layer.effect(
    SetupToken,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const { needsSetup } = yield* setupStatus
      let token: string | null = null
      if (needsSetup) {
        token = Option.match(config.setupToken, {
          onNone: () => generateToken(),
          onSome: Redacted.value,
        })
        const url = new URL(`/setup?token=${encodeURIComponent(token)}`, config.url)
        yield* Effect.logWarning(
          Option.isSome(config.setupToken)
            ? "Workspace not set up yet: open /setup with the SETUP_TOKEN"
            : `Workspace not set up yet: open ${url.toString()}`,
        )
      }
      return SetupToken.of({
        matches: (candidate) =>
          Effect.sync(() => {
            if (token === null) return false
            const a = Buffer.from(token)
            const b = Buffer.from(candidate)
            return a.length === b.length && timingSafeEqual(a, b)
          }),
        destroy: Effect.sync(() => {
          token = null
        }),
      })
    }),
  )
}
