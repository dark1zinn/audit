/**
 * Fractional indexing: string keys that sort lexicographically and can always be placed between
 * two neighbours, so moving one card rewrites one row. Keys use base-62 digits in ASCII order and
 * never end in the zero digit, which keeps `a < midpoint(a, b) < b` for every pair.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const ZERO = DIGITS[0]!
const TOP = DIGITS.length

export const MAX_KEY_LENGTH = 50

const digitIndex = (char: string): number => {
  const index = DIGITS.indexOf(char)
  if (index < 0) throw new RangeError(`Invalid ordering key digit: ${char}`)
  return index
}

const midpoint = (a: string | null, b: string | null): string => {
  if (b !== null && a !== null && a >= b) throw new RangeError("ordering: a must sort before b")
  if (b !== null) {
    // Shared prefix is copied, then the rest is bisected.
    let n = 0
    while ((a?.[n] ?? ZERO) === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a?.slice(n) ?? null, b.slice(n))
  }
  const digitA = a === null || a === "" ? 0 : digitIndex(a[0]!)
  const digitB = b === null || b === "" ? TOP : digitIndex(b[0]!)
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]!
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[digitA]! + midpoint(a === null ? null : a.slice(1), null)
}

const assertKey = (key: string) => {
  if (key.length === 0 || key.endsWith(ZERO)) throw new RangeError(`Invalid ordering key: ${key}`)
  for (const char of key) digitIndex(char)
}

/** A key strictly between `before` and `after`; `null` means the open end of the list. */
export const keyBetween = (before: string | null, after: string | null): string => {
  if (before !== null) assertKey(before)
  if (after !== null) assertKey(after)
  return midpoint(before, after)
}

/** `count` ascending keys strictly between `before` and `after`, evenly spread by bisection. */
export const keysBetween = (
  before: string | null,
  after: string | null,
  count: number,
): ReadonlyArray<string> => {
  if (count <= 0) return []
  const middle = keyBetween(before, after)
  const left = Math.floor((count - 1) / 2)
  return [
    ...keysBetween(before, middle, left),
    middle,
    ...keysBetween(middle, after, count - 1 - left),
  ]
}

/** Evenly spaced keys for a fresh list, e.g. when a column is first populated. */
export const initialKeys = (count: number): ReadonlyArray<string> => keysBetween(null, null, count)

/** True once a key has grown past the length we store; the board is then rebalanced. */
export const needsRebalance = (key: string): boolean => key.length > MAX_KEY_LENGTH
