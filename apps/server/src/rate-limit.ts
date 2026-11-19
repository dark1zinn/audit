/**
 * Fixed-window, in-memory rate limiting for unauthenticated endpoints (invite joins). One process
 * serves the workspace, so memory is the right store.
 */
import { RateLimited } from "@audit/domain/errors"
import { Context, Effect, Layer } from "effect"

export interface RateLimiterShape {
  readonly check: (bucket: string, key: string) => Effect.Effect<void, RateLimited>
}

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterShape>()(
  "@audit/server/RateLimiter",
) {}

export const rateLimiterLayer = (limits: Record<string, { max: number; windowMs: number }>) =>
  Layer.sync(RateLimiter, () => {
    const windows = new Map<string, { count: number; resetAt: number }>()
    return RateLimiter.of({
      check: (bucket, key) =>
        Effect.suspend(() => {
          const limit = limits[bucket]
          if (limit === undefined) return Effect.void
          const now = Date.now()
          const id = `${bucket}:${key}`
          const current = windows.get(id)
          if (current === undefined || current.resetAt <= now) {
            if (windows.size > 10_000) {
              for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k)
            }
            windows.set(id, { count: 1, resetAt: now + limit.windowMs })
            return Effect.void
          }
          current.count++
          if (current.count <= limit.max) return Effect.void
          return Effect.fail(
            new RateLimited({ retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) }),
          )
        }),
    })
  })
