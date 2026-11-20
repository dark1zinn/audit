# API reference

The HTTP API is served under `/api/`. The OpenAPI 3 document is generated from the same definitions
the server uses, so it matches the running code.

- Spec: [`openapi.json`](/api/openapi.json)
- Endpoint table: [endpoints](/api/endpoints)
- Live spec from a running server: `GET /api/openapi.json`

## Regenerating

```sh
bun run docs:openapi
```

`bun run docs:build` runs this first.

## Conventions

- All paths start with `/api/`.
- Requests and responses are JSON. Errors use typed bodies with HTTP status codes; `429` responses
  include `retryAfterSeconds`.
- Authentication is by session cookie set by sign-in. Pass cookies from the browser or from your own
  login flow. Better Auth routes live under `/api/auth/*`.
- Mutations that can conflict carry a `version`; a stale version returns `409 Conflict`.

## Unauthenticated endpoints

- `POST /api/setup` (first-run owner creation, requires the setup token)
- `POST /api/join` (invite acceptance)
- `POST /api/signup` (only when signup policy allows)

Other operational endpoints are outside `/api/`: `GET /healthz`, `GET /readyz`.

Some routes are plain HTTP handlers rather than part of the typed API, so they are not in the
OpenAPI document: `POST /api/admin/branding/logo` (PNG, JPEG or WebP, up to 2 MiB) and
`GET /api/admin/export` (NDJSON workspace export). Files are served under `/files/*`, calendar feeds
under `/ical/*`, and the realtime endpoints are `/rpc` (WebSocket) and `/collab` (WebSocket).

## Limits

Rate limits are listed in the [security model](/security#authentication).

## Authentication in the spec

The generated document declares no security scheme, and each operation has an empty `security`
list. Requests are authenticated by the session cookie, and unauthenticated access to a protected
endpoint returns `401`. The spec does not mark which operations require a session.
