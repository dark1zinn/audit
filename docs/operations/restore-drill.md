# Restore drill and upgrade test

The restore drill proves that a backup taken from a running database restores into an empty database with a fresh data directory, and that the restored instance starts and passes its checks. Run it before every release and after any change to backup, restore, or migrations.

## Prerequisites

- The dev database is up (`bun run db:up`); the scripts create and drop their own `audit_drill_*` and `audit_upgrade_*` databases on `postgres://audit:audit@127.0.0.1:5432`.
- PostgreSQL client tools matching the server major version (18) are on `PATH`: `pg_dump`, `pg_restore`, and `psql`. The CLI calls them by bare name.
- `tar` is on `PATH`.

## Run the drill

```sh
bun run drill
```

The drill runs these steps with the CLI, using temporary data directories:

1. `audit migrate` and `audit seed --demo` on the source database.
2. `audit backup` writes a backup directory.
3. `audit restore <dir>` into an empty database and an empty data directory.
4. Compares row counts of every table between source and target, and checks that a fixture file in the file store came back intact.
5. `audit trail verify` on the target.
6. `audit serve` on the target, then checks `/readyz` returns 200.

It exits 0 when every step passes and 1 otherwise. Temporary databases and directories are removed in every case.

## Run the upgrade test

```sh
bun run test:upgrade
```

This simulates restoring a backup taken by the previous release into this build. It copies `packages/db/drizzle` minus its newest migration folder, migrates and backs up the source with that copy (`MIGRATIONS_DIR` points at it), then restores into a fresh database with this build's migrations. It checks that the restore reports the older migration count, migrates forward, verifies the audit log, and reaches `/readyz`.

The previous migration set is derived at run time, so no fixture needs regenerating when migrations are added. Only the newest migration is dropped; if the restore format changes, update `scripts/upgrade-test.ts` and this page together.

## Backup and restore reference

```sh
audit backup [--out <dir>] [--age-recipient <age1…>]...
audit restore <path> [--force] [--age-identity <file>]
```

- A backup is a directory `audit-backup-<timestamp>/` with `database.dump` (pg_dump custom format), `files.tar` (the local file store), and `manifest.json` (format, creation time, app version, migration names, file checksums, encryption recipients).
- `--out` defaults to `BACKUP_DIR`, or `<DATA_DIR>/backups`.
- `--age-recipient` may be repeated. Both archives are then age-encrypted and the checksums cover the encrypted bytes. Restore needs `--age-identity <file>` for encrypted backups.
- S3 file stores are not archived; back up the bucket with the provider's tooling. The manifest records `driver: "s3"` with `skipped: true`.
- `restore` refuses a non-empty database or a non-empty file store unless `--force` is given. With `--force`, every non-system schema and the file store are replaced.
- Before changing anything, restore checks every checksum and that the backup's migrations are a prefix of this build's migrations. A backup from a newer build is refused.
- Restore migrates forward, records `backup.restored` in the audit log, and then verifies the chain.

Exit codes: 0 success; 1 usage error, refusal, or runtime error; 2 integrity failure (checksum mismatch, migration mismatch, or a broken audit log).

Every backup records `backup.created` in the audit log after the dump, so that entry is not in that backup's dump.

## Stale-backup warning

`audit serve` prints a warning when `BACKUP_DIR` is set (or the default backup directory exists) and no backup in it is newer than 24 hours. Set `BACKUP_DIR` in deployments so the warning is active.

## Account recovery

```sh
audit create-owner --email <address> [--name <name>] [--workspace <name>]
audit reset-password <email>
```

Both print a one-time password link that is valid for 24 hours. `create-owner` creates the workspace when none exists, creates an owner, or promotes an existing member. Neither command accepts a password on the command line.

## Search and embeddings

```sh
audit reindex   # rebuilds the search index and prints the number of entries updated
audit reembed   # queues embedding for every item; the running server processes the queue
```

## CI

The test job needs `pg_dump`, `pg_restore`, and `psql` for PostgreSQL 18 installed on the runner, because the backup and restore tests call them. The `pgvector/pgvector:pg18` service container does not provide them.

## Refreshing the drill after a schema change

Nothing needs refreshing: the drill builds its source from the current migrations and seed. If a migration makes the seed fail, fix the seed in the same change.
