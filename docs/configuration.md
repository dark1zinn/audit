# Configuration reference

audit reads all configuration from environment variables. Values are read at startup; restart the
server after changing them. Secret values are never written to logs.

## Required

| Variable           | Description                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUDIT_URL`        | Public origin of the instance, for example `https://audit.example.com`. Used for links, cookies, the calendar feed, and passkey relying-party ID (host part).                                                                                                                  |
| `AUDIT_SECRET_KEY` | Secret of at least 32 characters. Derives the keys that encrypt AI provider keys and that protect tokens. Startup fails with `AUDIT_SECRET_KEY must be at least 32 characters` if it is shorter. Losing it makes sealed AI keys unreadable; rotate with `audit rotate-secret`. |
| `DATABASE_URL`     | PostgreSQL connection string, for example `postgres://audit:…@postgres:5432/audit`. The database needs the pgvector extension. Treated as a secret.                                                                                                                            |

## Server

| Variable         | Default                       | Description                                                                                                                                                                                          |
| ---------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`           | `3000`                        | HTTP listen port.                                                                                                                                                                                    |
| `DATA_DIR`       | `./data`                      | Root for local state. Local files live in `${DATA_DIR}/files`; built-in backups default to `${DATA_DIR}/backups`.                                                                                    |
| `WEB_DIST`       | `./apps/web/dist`             | Directory with the built web app that the server serves. The container image sets `/app/web/dist`.                                                                                                   |
| `MIGRATIONS_DIR` | bundled `packages/db/drizzle` | Migration directory. The container image sets `/app/migrations`.                                                                                                                                     |
| `SETUP_TOKEN`    | generated                     | Token for the first-run setup page at `/setup`. If unset, a random token is generated and logged as a `/setup?token=…` URL on each start until setup completes. Set it when you need a stable value. |
| `TRUST_PROXY`    | `false`                       | Set to `true` only behind a reverse proxy that sets `x-forwarded-for`. The first entry is then used as the client IP for rate limits and audit records. When `false`, the header is ignored.         |
| `GIT_SHA`        | unset                         | Optional build identifier shown in the admin overview.                                                                                                                                               |

## Storage

| Variable               | Default          | Description                                                                |
| ---------------------- | ---------------- | -------------------------------------------------------------------------- |
| `STORAGE_DRIVER`       | `local`          | `local` stores files under `DATA_DIR/files`. `s3` stores them in a bucket. |
| `S3_BUCKET`            | —                | Required when `STORAGE_DRIVER=s3`.                                         |
| `S3_ACCESS_KEY_ID`     | —                | Required when `STORAGE_DRIVER=s3`. Treated as a secret.                    |
| `S3_SECRET_ACCESS_KEY` | —                | Required when `STORAGE_DRIVER=s3`. Treated as a secret.                    |
| `S3_ENDPOINT`          | provider default | Endpoint for S3-compatible services.                                       |
| `S3_REGION`            | provider default | Bucket region.                                                             |

Backups do not include S3 file contents; back up the bucket with your provider. See
[backups and upgrades](/operations/backups-and-upgrades).

## Email

| Variable    | Default | Description                                                                                                               |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_URL`  | unset   | SMTP connection URL. Without it email is disabled and the email notification channel is unavailable. Treated as a secret. |
| `MAIL_FROM` | unset   | Sender address for outgoing mail.                                                                                         |

## Web push

| Variable            | Default   | Description                                 |
| ------------------- | --------- | ------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | generated | VAPID public key.                           |
| `VAPID_PRIVATE_KEY` | generated | VAPID private key. Treated as a secret.     |
| `VAPID_SUBJECT`     | unset     | VAPID subject, usually a `mailto:` address. |

If the VAPID keys are not set, the server generates them per workspace and stores the private key
sealed with `AUDIT_SECRET_KEY`.

## Logging and telemetry

| Variable                      | Default                                          | Description                                                                                                      |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`                   | `info`                                           | Minimum level: `all`, `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `none`. Any other value fails startup. |
| `LOG_FORMAT`                  | `json` when `NODE_ENV=production`, else `pretty` | `json` or `pretty`.                                                                                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset                                            | When set, logs, metrics and traces are also exported over OTLP/HTTP. Console logging stays on.                   |
| `AUDIT_VERSION`               | `0.0.0`                                          | Service version reported to OpenTelemetry.                                                                       |

## Backups

| Variable     | Default               | Description                                                                                                                       |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_DIR` | `${DATA_DIR}/backups` | Output directory for `audit backup`. When set, `audit serve` also warns at startup if no backup newer than 24 hours exists there. |

## Test and development only

These are not read by a production deployment.

| Variable                                   | Description                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL`                        | Database used by the test suite.                                                |
| `DATABASE_URL` default in `drizzle.config` | `postgres://audit:audit@127.0.0.1:5432/audit`, used by local migration tooling. |
