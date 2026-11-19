/**
 * File bytes behind one interface: a local volume (default) or any S3-compatible store.
 */
import { mkdir, rm } from "node:fs/promises"
import { dirname, join, normalize } from "node:path"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { AppConfig, type StorageConfig } from "./config.ts"

export class BlobStoreError extends Schema.TaggedError<BlobStoreError>()("BlobStoreError", {
  operation: Schema.String,
  key: Schema.String,
  message: Schema.String,
}) {}

export interface BlobStoreShape {
  readonly put: (key: string, body: Blob | Uint8Array) => Effect.Effect<void, BlobStoreError>
  /** A Blob that streams lazily from the store, or `null` when the key does not exist. */
  readonly get: (key: string) => Effect.Effect<Blob | null, BlobStoreError>
  readonly delete: (key: string) => Effect.Effect<void, BlobStoreError>
}

const attempt = <A>(operation: string, key: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => new BlobStoreError({ operation, key, message: String(error) }),
  })

const localStore = (root: string): BlobStoreShape => {
  const pathOf = (key: string) => {
    const path = normalize(join(root, key))
    if (!path.startsWith(normalize(root))) throw new Error(`key escapes the store: ${key}`)
    return path
  }
  return {
    put: (key, body) =>
      attempt("put", key, async () => {
        const path = pathOf(key)
        await mkdir(dirname(path), { recursive: true })
        await Bun.write(path, body)
      }),
    get: (key) =>
      attempt("get", key, async () => {
        const file = Bun.file(pathOf(key))
        return (await file.exists()) ? file : null
      }),
    delete: (key) => attempt("delete", key, () => rm(pathOf(key), { force: true })),
  }
}

const s3Store = (config: Extract<StorageConfig, { driver: "s3" }>): BlobStoreShape => {
  const client = new Bun.S3Client({
    bucket: config.bucket,
    accessKeyId: Redacted.value(config.accessKeyId),
    secretAccessKey: Redacted.value(config.secretAccessKey),
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
    ...(config.region === undefined ? {} : { region: config.region }),
  })
  return {
    put: (key, body) =>
      attempt("put", key, async () => {
        await client.write(key, body)
      }),
    get: (key) =>
      attempt("get", key, async () => {
        const file = client.file(key)
        return (await file.exists()) ? file : null
      }),
    delete: (key) => attempt("delete", key, () => client.delete(key)),
  }
}

export const makeBlobStore = (config: StorageConfig): BlobStoreShape =>
  config.driver === "local" ? localStore(config.root) : s3Store(config)

export class BlobStore extends Context.Service<BlobStore, BlobStoreShape>()(
  "@audit/platform/BlobStore",
) {
  static readonly layer = Layer.effect(
    BlobStore,
    Effect.gen(function* () {
      const config = yield* AppConfig
      return makeBlobStore(config.storage)
    }),
  )
}
