/**
 * Server configuration, read once from the environment at start.
 */
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"

export interface S3Config {
  readonly driver: "s3"
  readonly bucket: string
  readonly endpoint: string | undefined
  readonly region: string | undefined
  readonly accessKeyId: Redacted.Redacted
  readonly secretAccessKey: Redacted.Redacted
}

export type StorageConfig = { readonly driver: "local"; readonly root: string } | S3Config

export interface AppConfigShape {
  /** Public URL for links, cookies and the ICS feed. */
  readonly url: URL
  readonly port: number
  readonly databaseUrl: Redacted.Redacted
  /** 32+ random bytes; derives the keys for AI-key encryption and tokens. */
  readonly secretKey: Redacted.Redacted
  readonly setupToken: Option.Option<Redacted.Redacted>
  readonly smtpUrl: Option.Option<Redacted.Redacted>
  readonly mailFrom: Option.Option<string>
  readonly storage: StorageConfig
  readonly dataDir: string
  readonly trustProxy: boolean
  readonly logLevel: string
  readonly otelEndpoint: Option.Option<string>
  /** Directory of the built web app, served for every path not handled by the server. */
  readonly webDist: string
}

export class InvalidConfig extends Schema.TaggedError<InvalidConfig>()("InvalidConfig", {
  message: Schema.String,
}) {}

const optionalString = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined))

const readStorage = (dataDir: string) =>
  Effect.gen(function* () {
    const driver = yield* Config.Literals(["local", "s3"], "STORAGE_DRIVER").pipe(
      Config.withDefault("local" as const),
    )
    if (driver === "local") return { driver, root: `${dataDir}/files` } satisfies StorageConfig
    return {
      driver,
      bucket: yield* Config.String("S3_BUCKET"),
      endpoint: yield* optionalString("S3_ENDPOINT"),
      region: yield* optionalString("S3_REGION"),
      accessKeyId: yield* Config.Redacted("S3_ACCESS_KEY_ID"),
      secretAccessKey: yield* Config.Redacted("S3_SECRET_ACCESS_KEY"),
    } satisfies StorageConfig
  })

export const readAppConfig = Effect.gen(function* () {
  const dataDir = yield* Config.String("DATA_DIR").pipe(Config.withDefault("./data"))
  const secretKey = yield* Config.Redacted("AUDIT_SECRET_KEY")
  if (Redacted.value(secretKey).length < 32) {
    return yield* new InvalidConfig({ message: "AUDIT_SECRET_KEY must be at least 32 characters" })
  }
  const config: AppConfigShape = {
    url: yield* Config.URL("AUDIT_URL"),
    port: yield* Config.Port("PORT").pipe(Config.withDefault(3000)),
    databaseUrl: yield* Config.Redacted("DATABASE_URL"),
    secretKey,
    setupToken: yield* Config.Redacted("SETUP_TOKEN").pipe(Config.option),
    smtpUrl: yield* Config.Redacted("SMTP_URL").pipe(Config.option),
    mailFrom: yield* Config.String("MAIL_FROM").pipe(Config.option),
    storage: yield* readStorage(dataDir),
    dataDir,
    trustProxy: yield* Config.Boolean("TRUST_PROXY").pipe(Config.withDefault(false)),
    logLevel: yield* Config.String("LOG_LEVEL").pipe(Config.withDefault("info")),
    otelEndpoint: yield* Config.String("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(Config.option),
    webDist: yield* Config.String("WEB_DIST").pipe(Config.withDefault("./apps/web/dist")),
  }
  return config
})

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()(
  "@audit/platform/AppConfig",
) {
  static readonly layer = Layer.effect(AppConfig, readAppConfig)
}
