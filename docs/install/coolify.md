# Install on Coolify

The repository includes `deploy/coolify.yml`, a Docker Compose resource for Coolify. It uses
Coolify's generated `SERVICE_*` values, so you do not manage secrets by hand.

## 1. Create the resource

1. In Coolify, create a **Docker Compose** resource from this repository.
2. Set the compose file path to `deploy/coolify.yml`.
3. Assign a domain to the `app` service. Coolify sets `SERVICE_URL_APP` from it.

## 2. Values Coolify generates

| Variable            | Source                                                   |
| ------------------- | -------------------------------------------------------- |
| `AUDIT_URL`         | `${SERVICE_URL_APP}` (the assigned domain, HTTPS)        |
| `AUDIT_SECRET_KEY`  | `${SERVICE_PASSWORD_64_AUDIT}` (64 generated characters) |
| `POSTGRES_PASSWORD` | `${SERVICE_PASSWORD_POSTGRES}`                           |

`LOG_LEVEL` defaults to `info`. To change it, set `LOG_LEVEL` in the resource environment.

## 3. Deploy

Deploy the resource. The `app` service builds `deploy/Dockerfile`, waits for the `postgres`
service to be healthy, and starts `audit serve`. The app health check calls `/readyz`.

Open the assigned domain and complete setup as described in [Docker Compose install](/install/docker#3-build-and-start).

## Notes

- Coolify terminates TLS. Keep `AUDIT_URL` on `https://`.
- If Coolify's proxy sets `x-forwarded-for` and you rely on client IPs for rate limits, set
  `TRUST_PROXY=true` in the resource environment. Leave it unset otherwise.
- Volumes `pgdata` and `files` persist across deploys. Use Coolify's backup features or
  `audit backup` for application-level backups; see [backups and upgrades](/operations/backups-and-upgrades).
