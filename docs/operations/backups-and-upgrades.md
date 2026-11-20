# Backups and upgrades

## What a backup contains

`audit backup` writes a directory named `audit-backup-<UTC timestamp>/` containing:

| File            | Contents                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `database.dump` | PostgreSQL custom-format dump (`pg_dump -Fc`)                                                         |
| `files.tar`     | The local file store. Not written for S3 storage; back up the bucket with your provider.              |
| `manifest.json` | Format version, audit version, applied migrations, creation time, and a SHA-256 per file              |
| `*.age`         | Present when encrypted: both data files are age-encrypted and the checksums cover the encrypted bytes |

The output directory is `--out <dir>`, else `BACKUP_DIR`, else `${DATA_DIR}/backups`.

```sh
audit backup --out /backups
audit backup --out /backups --age-recipient age1…
```

The `audit` command is the binary at `/app/audit` in the container:

```sh
docker compose -f deploy/compose.yml exec app /app/audit backup --out /data/backups
```

Keep `AUDIT_SECRET_KEY` with the backup. The database holds sealed AI keys and VAPID keys that only
that secret can open.

## Restore

```sh
audit restore <backup-directory> [--age-identity <file>] [--force]
```

- Verifies every checksum in `manifest.json` before changing anything.
- Refuses to restore into a non-empty database unless `--force` is given.
- Checks that the manifest's migration list is a prefix of the bundled migrations. A backup from a
  newer version is refused.
- After restore, `audit trail verify` is run and should report a valid chain.

Restore into a fresh PostgreSQL database and a fresh file store. The repository includes a restore
drill: `bun run drill` seeds demo data, backs it up, restores it into a new database, starts the
server, and compares counts and trail verification.

## Exit codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| `0`  | Success                                                                 |
| `1`  | Usage error, refusal (for example non-empty database), or runtime error |
| `2`  | Integrity failure: checksum, trail, or migration head mismatch          |

## Startup reminder

When `BACKUP_DIR` is set, or the default backup directory exists, `audit serve` logs a warning at
startup if there is no backup newer than 24 hours.

## Upgrades

1. Read the release notes for the target version.
2. Take a backup (above) and keep it until the upgrade is verified.
3. Pull the new code or image and rebuild:

   ```sh
   git pull
   docker compose -f deploy/compose.yml up --build -d
   ```

4. The server applies pending migrations at startup. You can also run them explicitly with
   `audit migrate`.
5. Check `/readyz` and the admin overview, which shows the running version and `GIT_SHA` when set.

Migrations are forward-only. To roll back, restore the backup taken before the upgrade into a
fresh database with the previous version.

`bun run test:upgrade` exercises an upgrade path from the previous migration set in the repository.
