/**
 * Per-account sign-in lockout. The per-IP rate limit alone lets one attacker try many passwords for
 * one account across many addresses; this counts failures per email with exponential backoff.
 * In memory, like the other limiters: one process serves the workspace.
 */
const FREE_ATTEMPTS = 5
const BASE_LOCK_MS = 30_000
const MAX_LOCK_MS = 15 * 60_000
const FORGET_AFTER_MS = 60 * 60_000
const MAX_TRACKED = 10_000

interface Entry {
  failures: number
  lastFailureAt: number
  lockedUntil: number
}

export interface SignInLockout {
  /** Seconds until the email may try again, or null when it may. */
  readonly lockedFor: (email: string) => number | null
  readonly recordFailure: (email: string) => void
  readonly reset: (email: string) => void
}

const normalize = (email: string) => email.trim().toLowerCase()

export const makeSignInLockout = (now: () => number = Date.now): SignInLockout => {
  const entries = new Map<string, Entry>()

  const prune = (at: number) => {
    if (entries.size <= MAX_TRACKED) return
    for (const [key, entry] of entries) {
      if (entry.lockedUntil <= at && at - entry.lastFailureAt > FORGET_AFTER_MS) {
        entries.delete(key)
      }
    }
  }

  return {
    lockedFor(email) {
      const entry = entries.get(normalize(email))
      const at = now()
      if (entry === undefined || entry.lockedUntil <= at) return null
      return Math.ceil((entry.lockedUntil - at) / 1000)
    },
    recordFailure(email) {
      const key = normalize(email)
      const at = now()
      const previous = entries.get(key)
      const stale = previous === undefined || at - previous.lastFailureAt > FORGET_AFTER_MS
      const failures = stale ? 1 : previous.failures + 1
      const overLimit = failures - FREE_ATTEMPTS
      const lockMs = overLimit <= 0 ? 0 : Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (overLimit - 1))
      entries.set(key, { failures, lastFailureAt: at, lockedUntil: at + lockMs })
      prune(at)
    },
    reset(email) {
      entries.delete(normalize(email))
    },
  }
}
