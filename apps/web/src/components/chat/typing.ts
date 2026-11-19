import { t } from "@lingui/core/macro"

/** Human label for the people currently typing in a channel. */
export const typingLabel = (names: ReadonlyArray<string>): string => {
  const [first, second] = names
  if (first === undefined) return ""
  if (second === undefined) return t`${first} is typing…`
  if (names.length === 2) return t`${first} and ${second} are typing…`
  return t`Several people are typing…`
}
