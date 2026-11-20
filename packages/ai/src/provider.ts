/**
 * Provider layers: one `LanguageModel` and one `EmbeddingModel` per configured provider. Every
 * kind is reached over HTTP through the `HttpClient` the caller provides, so tests inject a fake
 * at that boundary. Google speaks the OpenAI-compatible protocol at its Gemini endpoint.
 */
import { AiUnavailable } from "@audit/domain/ai/errors"
import type { AiProviderKind } from "@audit/domain/ai/schema"
import { ValidationError } from "@audit/domain/errors"
import * as AnthropicClient from "@effect/ai-anthropic/AnthropicClient"
import * as AnthropicLanguageModel from "@effect/ai-anthropic/AnthropicLanguageModel"
import * as CompatClient from "@effect/ai-openai-compat/OpenAiClient"
import * as CompatEmbeddingModel from "@effect/ai-openai-compat/OpenAiEmbeddingModel"
import * as CompatLanguageModel from "@effect/ai-openai-compat/OpenAiLanguageModel"
import * as OpenAiClient from "@effect/ai-openai/OpenAiClient"
import * as OpenAiEmbeddingModel from "@effect/ai-openai/OpenAiEmbeddingModel"
import * as OpenAiLanguageModel from "@effect/ai-openai/OpenAiLanguageModel"
import * as OpenRouterClient from "@effect/ai-openrouter/OpenRouterClient"
import * as OpenRouterLanguageModel from "@effect/ai-openrouter/OpenRouterLanguageModel"
import { Effect, Layer, type Redacted } from "effect"
import * as EmbeddingModel from "effect/ai/EmbeddingModel"
import * as LanguageModel from "effect/ai/LanguageModel"
import type { HttpClient } from "effect/http/HttpClient"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/** What a provider layer needs; the decrypted key only lives here, never in the domain view. */
export interface ProviderConfig {
  readonly kind: AiProviderKind
  readonly apiKey: Redacted.Redacted<string> | null
  readonly baseUrl: string | null
  readonly chatModel: string
  readonly embeddingModel: string | null
  readonly embeddingDimensions: number | null
}

export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

const OPENROUTER_REFERRER = "https://github.com/audit"

/** Kinds whose embedding endpoint the layers below can call. */
export const supportsEmbeddings = (kind: AiProviderKind): boolean =>
  kind === "openai" || kind === "google" || kind === "openai_compatible"

const apiKeyOption = (config: ProviderConfig) =>
  config.apiKey === null ? {} : { apiKey: config.apiKey }

const baseUrlOption = (config: ProviderConfig) =>
  config.baseUrl === null ? {} : { apiUrl: config.baseUrl }

/** OpenAI-compatible client for Google (fixed Gemini endpoint) and custom compatible servers. */
const compatClient = (config: ProviderConfig) =>
  CompatClient.layer({
    ...apiKeyOption(config),
    apiUrl: config.kind === "google" ? GOOGLE_BASE_URL : (config.baseUrl ?? undefined),
  })

const failLanguageModel = (message: string) =>
  Layer.effect(LanguageModel.LanguageModel, Effect.fail(new AiUnavailable({ message })))

const failEmbeddingModel = (message: string) =>
  Layer.effect(EmbeddingModel.EmbeddingModel, Effect.fail(new AiUnavailable({ message })))

export const languageModelLayer = (
  config: ProviderConfig,
): Layer.Layer<LanguageModel.LanguageModel, AiUnavailable, HttpClient> => {
  switch (config.kind) {
    case "openai":
      return OpenAiLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(OpenAiClient.layer({ ...apiKeyOption(config), ...baseUrlOption(config) })),
      )
    case "anthropic":
      return AnthropicLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(AnthropicClient.layer({ ...apiKeyOption(config), ...baseUrlOption(config) })),
      )
    case "openrouter":
      return OpenRouterLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(
          OpenRouterClient.layer({
            ...apiKeyOption(config),
            ...baseUrlOption(config),
            siteReferrer: OPENROUTER_REFERRER,
          }),
        ),
      )
    case "google":
    case "openai_compatible":
      if (config.kind === "openai_compatible" && config.baseUrl === null)
        return failLanguageModel("OpenAI-compatible providers need a base URL")
      return CompatLanguageModel.layer({ model: config.chatModel }).pipe(
        Layer.provide(compatClient(config)),
      )
  }
}

/** The embedding model for a provider; fails `AiUnavailable` when the kind has none. */
export const embeddingModelLayer = (
  config: ProviderConfig,
): Layer.Layer<EmbeddingModel.EmbeddingModel, AiUnavailable, HttpClient> => {
  if (config.embeddingModel === null || config.embeddingDimensions === null)
    return failEmbeddingModel("No embedding model is configured")
  const model = config.embeddingModel
  const dimensions = config.embeddingDimensions
  switch (config.kind) {
    case "openai":
      return OpenAiEmbeddingModel.layer({ model, config: { dimensions } }).pipe(
        Layer.provide(OpenAiClient.layer({ ...apiKeyOption(config), ...baseUrlOption(config) })),
      )
    case "google":
    case "openai_compatible":
      if (config.kind === "openai_compatible" && config.baseUrl === null)
        return failEmbeddingModel("OpenAI-compatible providers need a base URL")
      return CompatEmbeddingModel.layer({ model, config: { dimensions } }).pipe(
        Layer.provide(compatClient(config)),
      )
    case "anthropic":
    case "openrouter":
      return failEmbeddingModel(`${config.kind} has no embedding endpoint`)
  }
}

/** IPv4 octets from dotted-quad text; null when malformed. */
const parseIPv4 = (text: string): ReadonlyArray<number> | null => {
  const parts = text.split(".")
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

/** Hextets of a canonical IPv6 address (as WHATWG URL and `dns.lookup` print it); null if malformed. */
const parseIPv6 = (address: string): ReadonlyArray<number> | null => {
  const halves = address.split("::")
  if (halves.length > 2) return null
  const hextets = (part: string): Array<number> | null => {
    if (part === "") return []
    const pieces = part.split(":")
    const out: Array<number> = []
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes(".")) {
        const octets = parseIPv4(piece)
        if (octets === null || index !== pieces.length - 1) return null
        const [a = 0, b = 0, c = 0, d = 0] = octets
        out.push(a * 256 + b, c * 256 + d)
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) {
        out.push(Number.parseInt(piece, 16))
      } else {
        return null
      }
    }
    return out
  }
  const head = hextets(halves[0] ?? "")
  if (head === null) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const tail = hextets(halves[1] ?? "")
  if (tail === null) return null
  const fill = 8 - head.length - tail.length
  return fill < 1 ? null : [...head, ...Array.from({ length: fill }, () => 0), ...tail]
}

/** Blocked IPv4 ranges: unspecified, loopback, RFC1918, link-local, CGNAT. */
const blockedIPv4 = (octets: ReadonlyArray<number>): boolean => {
  const [a = -1, b = -1] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** Whether a canonical IP literal falls in a blocked range. Unparsable input is blocked. */
const addressIsBlocked = (address: string): boolean => {
  const version = isIP(address)
  if (version === 4) {
    const octets = parseIPv4(address)
    return octets === null || blockedIPv4(octets)
  }
  if (version !== 6) return true
  const hextets = parseIPv6(address)
  if (hextets === null) return true
  const bytes = hextets.flatMap((hextet) => [hextet >> 8, hextet & 0xff])
  const leadingZeros = (count: number) => bytes.slice(0, count).every((byte) => byte === 0)
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, which also covers :: and ::1).
  if (leadingZeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return blockedIPv4(bytes.slice(12))
  }
  if (leadingZeros(12)) return blockedIPv4(bytes.slice(12))
  const [b0 = 0, b1 = 0] = bytes
  // Link-local fe80::/10 and unique-local fc00::/7.
  return (b0 === 0xfe && (b1 & 0xc0) === 0x80) || (b0 & 0xfe) === 0xfc
}

const isLocalName = (host: string): boolean => host === "localhost" || host.endsWith(".localhost")

/**
 * Rejects provider base URLs that carry credentials, are not https, or (unless `allowPrivate`)
 * reach loopback, private, link-local, CGNAT or unspecified addresses. Every address a name
 * resolves to must be public, and a name that does not resolve is rejected. With `allowPrivate`,
 * plain http is also accepted when the host is local or private (self-hosted model servers rarely
 * have TLS), never for a public host, where the API key would travel in cleartext.
 */
export const validateBaseUrl = (
  raw: string,
  options: { readonly allowPrivate: boolean },
): Effect.Effect<void, ValidationError> =>
  Effect.gen(function* () {
    if (!URL.canParse(raw)) {
      return yield* new ValidationError({ message: "The base URL is not a valid URL" })
    }
    const url = new URL(raw)
    const notHttps = new ValidationError({ message: "The base URL must use https" })
    if (url.protocol !== "https:" && url.protocol !== "http:") return yield* notHttps
    if (url.username !== "" || url.password !== "") {
      return yield* new ValidationError({ message: "The base URL must not contain credentials" })
    }
    if (url.protocol === "https:" && options.allowPrivate) return
    if (url.protocol === "http:" && !options.allowPrivate) return yield* notHttps

    const host = url.hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "")
    const addresses: ReadonlyArray<string> = isLocalName(host)
      ? []
      : isIP(host) !== 0
        ? [host]
        : yield* Effect.promise(() =>
            lookup(host, { all: true, verbatim: true }).then(
              (records) => records.map((record) => record.address),
              (): Array<string> => [],
            ),
          )
    if (url.protocol === "http:") {
      // allowPrivate is set: http only when every address is local or private.
      const privateHost =
        isLocalName(host) || (addresses.length > 0 && addresses.every(addressIsBlocked))
      if (!privateHost) return yield* notHttps
      return
    }
    const blocked = new ValidationError({
      message: "The base URL must not point at a private or local address",
    })
    if (isLocalName(host)) return yield* blocked
    if (addresses.length === 0) {
      return yield* new ValidationError({ message: "The base URL host could not be resolved" })
    }
    if (addresses.some(addressIsBlocked)) return yield* blocked
  })
