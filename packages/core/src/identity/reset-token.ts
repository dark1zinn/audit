import { sha256Hex } from "@audit/platform/crypto"

/** Prefix Better Auth gives every password-reset verification row. */
export const RESET_IDENTIFIER_PREFIX = "reset-password:"

/**
 * The verification identifier stored for a reset token. Only the token's hash is persisted, so a
 * database read cannot be replayed as a reset.
 */
export const resetIdentifier = (token: string) => `${RESET_IDENTIFIER_PREFIX}${sha256Hex(token)}`
