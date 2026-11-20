# audit

audit is a self-hosted workspace for projects, task boards, collaborative docs, chat, calendars,
an inbox, search, and an optional AI assistant. It runs as one Bun server and one PostgreSQL 18
database with pgvector.

## Where to start

- **Operators** install with [Docker Compose](/install/docker) or [Coolify](/install/coolify), then read the
  [configuration reference](/configuration).
- **Workspace admins** use the [admin console guide](/admin/).
- **Members** start with [projects and the board](/user/projects-and-board).
- **Security reviewers** read the [security model](/security).
- **Operators** plan [backups and upgrades](/operations/backups-and-upgrades).
- **Integrators** use the [API reference](/api/).

## What runs

| Part                     | Role                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `audit serve`            | HTTP API, web app, WebSocket collaboration (`/collab`), RPC (`/rpc`), background jobs |
| PostgreSQL 18 + pgvector | All application data, the audit trail, full-text and vector search                    |
| File store               | Local volume (default) or any S3-compatible bucket                                    |

The server also exposes `GET /healthz` (process is up) and `GET /readyz` (database reachable and migrations applied; `503` otherwise).
