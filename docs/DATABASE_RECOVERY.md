# CampusGig database backup and recovery

CampusGig uses a PostgreSQL custom-format logical backup for portable recovery
checks. The drill creates a live-consistent `pg_dump`, restores it into a new
temporary database, verifies migration parity and critical tables, then removes
that temporary database. It never restores over the source database.

## Local drill

Start the local PostgreSQL service, then run:

```powershell
docker compose up -d postgres
npm run db:backup:verify
```

Successful output identifies the `.dump` and `.manifest.json` files under
`backups/postgres/`. The manifest records the backup SHA-256, PostgreSQL version,
size, migration count, critical-table row counts, verification time, and proof
that the temporary database was removed. The `backups/` directory and `*.backup`
files are excluded from Git.

To create a backup without restoring it:

```powershell
npm run db:backup
```

To verify a particular existing backup:

```powershell
npm run db:restore:verify -- --backup-file backups/postgres/campusgig-TIMESTAMP.dump
```

The verifier rejects modified dumps when a sidecar manifest is present. It also
fails if the restored Prisma migration list differs from the repository or any
critical table cannot be counted.

## Staging drill

Run from the repository root on the staging host:

```bash
node scripts/postgres-backup.mjs drill \
  --compose-file deploy/staging/compose.yml \
  --env-file deploy/staging/.env
```

The script reads `POSTGRES_USER` and `POSTGRES_DB` from the running PostgreSQL
container. It does not place the database password in the command line or backup
manifest.

## Safety boundaries

- Temporary restore names must begin with `campusgig_restore_verify_` and pass a
  strict identifier check before any create, connection termination, or drop.
- The source database name can never be used as the verification target.
- Restore runs with `--exit-on-error --single-transaction`, without ownership or
  privilege replay.
- Cleanup runs even when restore or verification fails. A cleanup failure causes
  the drill itself to fail and must be investigated immediately.
- Backup files contain private account, order, message, and payment metadata.
  Store them only on encrypted storage with restricted access and lifecycle
  retention. Never email a dump or commit it to Git.

## Production policy

Use provider-managed encrypted backups and point-in-time recovery as the primary
production protection. Keep logical CampusGig backups in a separate encrypted
account or storage location, not only on the application server. Schedule the
restore drill regularly and alert on missing backups, hash failures, restore
failures, migration mismatches, or cleanup failures. Record measured recovery
time and backup age before setting formal RTO and RPO targets.
