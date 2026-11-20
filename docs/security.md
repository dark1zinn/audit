# Security model

This page describes what audit enforces today. Items marked **not implemented** are known gaps.

## Authorization

Every request is checked against a workspace role and, for resources, a resource role.

**Workspace roles:** `owner`, `admin`, `member`, `guest`.

**Resource roles** (ordered): `viewer` < `commenter` < `editor` < `manager`. Team roles are `member`
or `lead`.

Actions map to the minimum resource role:

| Actions                                  | Minimum role |
| ---------------------------------------- | ------------ |
| read                                     | viewer       |
| comment, react, reply, post              | commenter    |
| create, update, move, delete own         | editor       |
| delete, archive, settings, manage access | manager      |

Workspace capabilities:

| Capability                                                                                                                             | owner | admin | member                           | guest |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- | -------------------------------- | ----- |
| Workspace settings, members management, AI configuration, invites management, teams, trail read, private channel read, access override | yes   | yes   | no                               | no    |
| Create invites                                                                                                                         | yes   | yes   | only if `membersCanInvite` is on | no    |
| Create projects, create public channels                                                                                                | yes   | yes   | yes                              | no    |
| Transfer workspace, delete workspace, delete members                                                                                   | yes   | no    | no                               | no    |

Private channels are visible to their members. Administrators can open a private channel read-only;
every such view is recorded in the audit trail (`admin.read_private`) and the page says so.

Search results and AI tool results are filtered by the same visibility rules, in the database query
itself.

## Authentication

- Accounts use email and password (Better Auth). Passwords are 10 to 256 characters.
- Optional breached-password check against the Have I Been Pwned range API using k-anonymity; the
  first five hex characters of the password's SHA-1 hash are sent, not the password. If the check cannot complete, the change is refused
  (fails closed). Off by default.
- Two-factor authentication: TOTP (6 digits, 30-second step) and backup codes. Passkeys are supported
  through WebAuthn; the relying-party ID is the host of `AUDIT_URL`.
- Workspace 2FA policy: `off`, `admins`, or `everyone`.
- Sessions: lifetime is the shorter of `sessionDays` (1–365, default 30) and `idleDays` (1–90,
  default 7), enforced on each request.
- Rate limits: sign-in, 2FA verification and password reset allow 5 attempts per 60 seconds. Join and
  signup have application limits (join 20 per 10 minutes; signup 10 per 60 minutes). Responses are
  `429` with `retryAfterSeconds`.
- Session cookies are `httpOnly`, `sameSite=lax`, and `secure` over HTTPS.
- Password reset links and invite tokens are single-use secrets. Reset links expire after 24 hours.
  Invite tokens are stored hashed and shown once. Invites default to 7 days.
- Deactivating a member and resetting 2FA revoke that member's sessions.

## Signup

Signup is **closed** by default. The admin can open it to specific email domains. A new account from
signup is a `member`. Invited accounts take the role on the invite (`member` or `guest`).

## Secrets at rest

- `AUDIT_SECRET_KEY` derives keys with HKDF. AI provider API keys and generated VAPID private keys are
  sealed with AES-256-GCM. Only the last four characters of an AI key are shown.
- Calendar subscription tokens are stored as SHA-256 hashes.
- `audit rotate-secret --from <old>` reseals AI keys and VAPID keys under a new secret.

## Audit trail

- Security-relevant and data-changing actions are written to `trail_events`, which is hash-chained.
  The database triggers reject updates and deletes of trail rows.
- The application role `audit_app` has no `UPDATE`, `DELETE`, or `TRUNCATE` on the trail. Only
  `audit_retention` may purge rows, and each purge is itself recorded (`trail.purged`).
- Retention is `trailRetentionDays` (30–3650, default 365).
- `audit trail verify` recomputes the chain. Admins can run the same check from the audit page.

## HTTP hardening

Responses from the web app carry:

- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

Downloaded files are served with `Content-Security-Policy: sandbox; default-src 'none'`.

Client IP handling: the server sets `x-audit-client-ip` itself. A value sent by the client is
removed. The forwarded header is trusted only when `TRUST_PROXY=true`.

HSTS is **not** set by the application; configure it at your reverse proxy.

## AI data handling

When AI is enabled, text needed for a request is sent to the configured provider: the conversation,
tool results the user can already see, and embedding chunks of indexed items. Each feature is off
until an admin enables it. Write actions from the assistant become proposals that a user must
approve; they run with that user's permissions. See the [AI assistant guide](/user/assistant).

**Known gap:** outbound requests to an AI provider `baseUrl` and to `SMTP_URL` are not restricted by
host or address. Only trusted administrators should set them.

## Reporting

Report vulnerabilities to the repository maintainers privately before public disclosure.
