/**
 * Web Push transport: RFC 8291 aes128gcm payload encryption and RFC 8292 VAPID (ES256) signing,
 * both with WebCrypto. The HTTP call is injected so tests can stub the boundary.
 */
import { Context, Effect, Layer } from "effect"
import { endpointAllowed, type Resolve, resolveHost } from "./push-address.ts"

export interface PushSubscription {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
}

/** `delivered`, `gone` (the subscription is dead and must be removed) or `failed` (retry later). */
export type PushOutcome = "delivered" | "gone" | "failed"

export interface VapidConfig {
  readonly publicKey: string
  readonly privateKey: string
  readonly subject: string
}

export type PostFn = (url: string, init: RequestInit) => Promise<Response>

export class PushTransport extends Context.Service<
  PushTransport,
  {
    /** The VAPID public key that subscribers pass to `pushManager.subscribe`. */
    readonly publicKey: Effect.Effect<string>
    /** Whether a subscription endpoint may receive a push (https, public host). */
    readonly allowsEndpoint: (endpoint: string) => Effect.Effect<boolean>
    readonly send: (subscription: PushSubscription, message: string) => Effect.Effect<PushOutcome>
  }
>()("@audit/core/PushTransport") {
  /**
   * Web Push over HTTP. `vapid` resolves the keys once, on first use (see `vapid.ts`); `post` is
   * the HTTP boundary, injected so tests can stub it.
   */
  static readonly live = <R>(
    vapid: Effect.Effect<VapidConfig, never, R>,
    post: PostFn = (url, init) => fetch(url, init),
    resolve: Resolve = resolveHost,
  ) =>
    Layer.effect(
      PushTransport,
      Effect.gen(function* () {
        const context = yield* Effect.context<R>()
        const keys = yield* Effect.cached(Effect.provideContext(vapid, context))
        return {
          publicKey: keys.pipe(Effect.map((config) => config.publicKey)),
          allowsEndpoint: (endpoint) =>
            Effect.promise(() => endpointAllowed(endpoint, resolve).catch(() => false)),
          send: (subscription, message) =>
            keys.pipe(
              Effect.flatMap((config) =>
                Effect.promise(() => deliver(config, post, resolve, subscription, message)),
              ),
            ),
        }
      }),
    )
}

const deliver = async (
  vapid: VapidConfig,
  post: PostFn,
  resolve: Resolve,
  subscription: PushSubscription,
  message: string,
): Promise<PushOutcome> => {
  try {
    // Checked again here, after the subscription was stored: the host may now resolve elsewhere.
    if (!(await endpointAllowed(subscription.endpoint, resolve))) return "failed"
    const body = await encryptPayload(subscription, new TextEncoder().encode(message))
    const jwt = await vapidToken(vapid, new URL(subscription.endpoint).origin)
    const response = await post(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
      },
      body,
    })
    if (response.status === 404 || response.status === 410) return "gone"
    return response.ok ? "delivered" : "failed"
  } catch {
    return "failed"
  }
}

const enc = new TextEncoder()

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(value, "base64url"))

const toBase64Url = (bytes: ArrayBuffer | Uint8Array): string =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url")

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const hkdf = (
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bits: number,
): Promise<ArrayBuffer> =>
  crypto.subtle
    .importKey("raw", ikm, "HKDF", false, ["deriveBits"])
    .then((key) =>
      crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits),
    )

/** RFC 8291: encrypt one payload for a subscription as a single aes128gcm record. */
const encryptPayload = async (
  subscription: PushSubscription,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> => {
  const uaPublic = fromBase64Url(subscription.p256dh)
  const authSecret = fromBase64Url(subscription.auth)
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey))
  const receiver = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  )
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: receiver },
    ephemeral.privateKey,
    256,
  )
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic)
  const ikm = new Uint8Array(await hkdf(authSecret, new Uint8Array(shared), keyInfo, 256))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = new Uint8Array(
    await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 128),
  )
  const nonce = new Uint8Array(await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 96))
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"])
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      concat(plaintext, new Uint8Array([2])),
    ),
  )
  const recordSize = new Uint8Array([0, 0, 16, 0])
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, sealed)
}

/** RFC 8292: an ES256 JWT for the push service origin, signed with the VAPID private key. */
const vapidToken = async (vapid: VapidConfig, audience: string): Promise<string> => {
  const publicBytes = fromBase64Url(vapid.publicKey)
  const header = toBase64Url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))
  const payload = toBase64Url(
    enc.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  )
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(publicBytes.slice(1, 33)),
      y: toBase64Url(publicBytes.slice(33, 65)),
      d: vapid.privateKey,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${toBase64Url(signature)}`
}
