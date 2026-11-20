/**
 * Per-email cap on password-reset requests. The per-IP limit alone lets one inbox be mailed from
 * many addresses. Every requested address counts, known or not, so the reply reveals nothing.
 * In memory, like the other limiters: one process serves the workspace.
 */
const MAX_REQUESTS = 3
const WINDOW_MS = 60 * 60_000
const MAX_TRACKED = 10_000

export interface ResetRequestLimit {
  /** False once the email has used its requests for the window; an allowed call counts. */
  readonly allow: (email: string) => boolean
}

const normalize = (email: string) => email.trim().toLowerCase()

export const makeResetRequestLimit = (now: () => number = Date.now): ResetRequestLimit => {
  const requests = new Map<string, number[]>()

  return {
    allow(email) {
      const key = normalize(email)
      const at = now()
      const recent = (requests.get(key) ?? []).filter((time) => at - time < WINDOW_MS)
      const allowed = recent.length < MAX_REQUESTS
      if (allowed) recent.push(at)
      requests.set(key, recent)
      if (requests.size > MAX_TRACKED) {
        for (const [stale, times] of requests) {
          if (times.every((time) => at - time >= WINDOW_MS)) requests.delete(stale)
        }
      }
      return allowed
    },
  }
}
