# Contributing to audit

Thanks for helping. audit is Apache 2.0 licensed; contributions are accepted under the
[Developer Certificate of Origin](https://developercertificate.org/), with no CLA.

## Development environment

The repository ships a Nix flake with the toolchain (`nix develop`, or `direnv allow`).

```sh
bun install
cp .env.example .env
bun run db:up        # PostgreSQL 18 + pgvector in Docker
bun run dev          # server and web app
```

## Checks

Run these before opening a pull request; CI runs the same ones.

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun test
```

## Conventions

- Code is organised by feature (`tasks`, `docs`, `chat`, `calendar`), each with `schema.ts`,
  `commands.ts`, `queries.ts`, `api.ts` and `rpc.ts`.
- Handlers never touch the database: writes go through commands, reads through queries. Commands
  are the only place that checks permissions and writes the audit log.
- Every bug fix adds a test at the lowest level that reproduces it.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with a short body
  describing the change.
- User-visible changes add a changeset (`bun changeset`).
- New user-facing strings go through Lingui and need entries in every catalog.

## Pull requests

Keep pull requests focused, describe the change and how you tested it, and link the issue it
closes. Security issues follow [SECURITY.md](SECURITY.md) instead.
