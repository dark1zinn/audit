# Admin console

Admins (`owner` and `admin` workspace roles) open the admin console from the workspace menu. It has
these pages, in the order shown in the navigation.

## Overview

Shows counts, the running version and `GIT_SHA` (when set), and a button to verify audit trail
integrity.

## Projects

Lists every project with its status. Actions:

- **Archive** and **unarchive**: archived projects are read-only.
- **Restore**: returns a soft-deleted project.
- **Delete**: permanent after the soft-delete retention window. You must type the project key to
  confirm.

## Members

Lists workspace members. For each member:

- Change the workspace role (`owner`, `admin`, `member`, `guest`). Ownership moves through **Transfer
  ownership**, which only the owner can use.
- **Password reset link**: creates a single-use link valid for 24 hours. Share it privately.
- **Deactivate** and **reactivate**: deactivation revokes all sessions and blocks sign-in.
- **Revoke sessions**: signs the member out everywhere.
- **Reset 2FA**: removes two-factor methods and revokes sessions.
- **Delete member**: removes the account. Owner only.
- Open the member's private channel view from the links on the page (see **Channels** below).

## Invites

Create invitations with:

- Role: `member` or `guest`.
- Expiry in hours (1–2160; default 7 days).
- Maximum uses (1–1000; default 1).
- Teams to join, project grants, and an internal note.

The invite link is shown once. **Revoke** disables an invite; the event is recorded.

## Teams

Create teams, add members, set a member as `lead`, or remove members.

## Audit

Lists audit trail events, filterable by action. **Verify** recomputes the hash chain and reports
whether it is intact. Requires `trail.read`, which owners and admins have.

## Workspace

Settings for the whole workspace:

| Setting                                             | Values and limits                                |
| --------------------------------------------------- | ------------------------------------------------ |
| Name, accent color, default language, default theme | Default language `en`; theme `system` by default |
| Two-factor policy                                   | `off`, `admins`, or `everyone`                   |
| Members can invite                                  | Off by default                                   |
| Session days                                        | 1–365 (default 30)                               |
| Idle days                                           | 1–90 (default 7)                                 |
| Trail retention days                                | 30–3650 (default 365)                            |

## Access

Review who can reach which entity. Shows access by item and by person. Requires `access.override`,
which owners and admins have. Changes made here are recorded in the audit trail.

## Security

- **Signup policy**: `closed` (default) or `domains`, with a list of allowed email domains.
- **Breached-password check**: on or off. When on, the password check refuses passwords found in
  known breaches, and fails closed if the check service cannot be reached.
- **Minimum password length**: shown read-only (10).

## Email

Shows whether email is configured (`SMTP_URL` and `MAIL_FROM`) and lets you send a test message.
When SMTP is not configured, email notifications are unavailable.

## Storage

Shows storage usage and lets you clean up orphaned files (files with no owning record).

## Retention

| Data          | Range                             | Default               |
| ------------- | --------------------------------- | --------------------- |
| Audit trail   | 30–3650 days                      | 365                   |
| Deleted files | 1–3650 days                       | per workspace setting |
| Messages      | 1–3650 days, or empty for forever | forever               |

Message purging keeps pinned messages; replies to purged messages become tombstones.

## Branding

- Workspace name (1–80 characters).
- Logo: PNG, JPEG or WebP, up to 2 MiB.
- Accent color and default theme.

## Maintenance

- **Rebalance boards**: re-sequences task positions on every board.
- **Compact docs**: merges stored document updates to reduce size.
- **Reindex search**: rebuilds full-text search entries.
- **Reembed**: regenerates semantic-search vectors for the current embedding provider.
- **Export**: downloads a full NDJSON export of the workspace (`GET /api/admin/export`).

## AI

- **Settings**: enable AI for the workspace, choose allowed roles (default `owner`, `admin`,
  `member`), turn each feature on or off, set an optional monthly token budget, and set conversation
  retention (1–3650 days, default 90).
- **Providers**: add, edit, delete and test providers (`openai`, `anthropic`, `google`, `openrouter`,
  `openai_compatible`). Keys are sealed; only the last four characters are displayed.
- **Usage**: monthly token usage.

AI is off until you enable it. See the [AI assistant guide](/user/assistant) for what each feature does.

## Channels

Opening a private channel from **Members** or the admin navigation shows a read-only view with the
banner "You are reading this private channel as an administrator. Access is logged." Every open is
recorded in the audit trail.
