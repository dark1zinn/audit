/**
 * Secrets derived from AUDIT_SECRET_KEY, token generation and AES-256-GCM sealing for values kept
 * encrypted at rest (AI provider keys).
 */
import { Context, Effect, Layer, Redacted } from "effect"
import { AppConfig } from "./config.ts"

/** 32 random bytes, base64url; shown once, stored only as its SHA-256. */
export const generateToken = (bytes = 32): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url")

export const sha256Hex = (value: string | Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex")

export interface Sealed {
  readonly ciphertext: string
  readonly nonce: string
}

export interface SecretsShape {
  /** Encrypts with a key derived (HKDF) from the server secret for `purpose`. */
  readonly seal: (purpose: string, plaintext: string) => Effect.Effect<Sealed>
  readonly open: (purpose: string, sealed: Sealed) => Effect.Effect<Redacted.Redacted<string>>
}

const deriveKey = async (secret: string, purpose: string): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("audit"),
      info: new TextEncoder().encode(purpose),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

export const makeSecrets = (secret: Redacted.Redacted<string>): SecretsShape => {
  const keys = new Map<string, Promise<CryptoKey>>()
  const keyFor = (purpose: string) => {
    let key = keys.get(purpose)
    if (key === undefined) {
      key = deriveKey(Redacted.value(secret), purpose)
      keys.set(purpose, key)
    }
    return key
  }
  return {
    seal: (purpose, plaintext) =>
      Effect.promise(async () => {
        const nonce = crypto.getRandomValues(new Uint8Array(12))
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce },
          await keyFor(purpose),
          new TextEncoder().encode(plaintext),
        )
        return {
          ciphertext: Buffer.from(ciphertext).toString("base64"),
          nonce: Buffer.from(nonce).toString("base64"),
        }
      }),
    open: (purpose, sealed) =>
      Effect.promise(async () => {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: Buffer.from(sealed.nonce, "base64") },
          await keyFor(purpose),
          Buffer.from(sealed.ciphertext, "base64"),
        )
        return Redacted.make(new TextDecoder().decode(plaintext))
      }),
  }
}

export class Secrets extends Context.Service<Secrets, SecretsShape>()("@audit/platform/Secrets") {
  static readonly layer = Layer.effect(
    Secrets,
    Effect.gen(function* () {
      const config = yield* AppConfig
      return makeSecrets(config.secretKey)
    }),
  )
}
