# Install with Docker Compose

This runs the audit server and PostgreSQL 18 with pgvector from `deploy/compose.yml`.

## Requirements

- Docker with Compose v2.
- A public HTTPS origin for the instance (a reverse proxy in front of port 3000 is recommended).

## 1. Get the code

```sh
git clone <repository-url> audit
cd audit
```

## 2. Create `deploy/.env`

Compose reads variables from `deploy/.env`. Set the four required values:

```dotenv
AUDIT_URL=https://audit.example.com
AUDIT_SECRET_KEY=<at least 32 random characters>
POSTGRES_PASSWORD=<owner database password>
APP_DB_PASSWORD=<app database password>
```

Generate a secret with `openssl rand -base64 48`. `POSTGRES_PASSWORD` is the owner login that runs migrations. The server connects as `audit_app` with `APP_DB_PASSWORD`, which cannot delete audit trail rows. The app role is created when the Postgres volume is first initialized. Keep `AUDIT_SECRET_KEY` safe: it protects sealed AI provider keys and tokens, and backups cannot be restored usefully without the same key.

Optional values, all documented in the [configuration reference](/configuration):

- `AUDIT_PORT` (host port, default `3000`)
- `LOG_LEVEL` (default `info`)
- `SETUP_TOKEN`, `TRUST_PROXY`, `OTEL_EXPORTER_OTLP_ENDPOINT`

## 3. Build and start

```sh
docker compose -f deploy/compose.yml up --build -d
```

The `app` service builds `deploy/Dockerfile`, runs `audit serve`, and waits for PostgreSQL to be
healthy. Migrations are applied when the server starts.

Open `AUDIT_URL` in a browser. On a new instance the setup page asks for the owner account and
requires the setup token. If `SETUP_TOKEN` is unset, the server logs a `/setup?token=…` URL on each
start until setup is complete:

```sh
docker compose -f deploy/compose.yml logs app | grep -i setup
```

Alternatively, create the owner from the command line. The command prints a one-time link (valid 24
hours) where the owner sets a password:

```sh
docker compose -f deploy/compose.yml exec app /app/audit create-owner --email you@example.com --name "Your Name"
```

## Data and volumes

| Volume   | Contents                                               |
| -------- | ------------------------------------------------------ |
| `pgdata` | PostgreSQL data                                        |
| `files`  | Uploaded files at `/data/files` (local storage driver) |

Backups and restores are covered in [backups and upgrades](/operations/backups-and-upgrades).

## Stopping

The container handles `SIGTERM`: it stops accepting connections, flushes collaborative documents
and job workers, then exits. `stop_grace_period` is 30 seconds.

```sh
docker compose -f deploy/compose.yml down
```

Add `-v` only if you intend to delete the volumes.
