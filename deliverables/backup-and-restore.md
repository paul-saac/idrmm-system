# IDRMM backup and restore

Backup & Restore appears in Settings for an accepted, active Super Administrator.
Administrators, Project Managers and Foremen cannot request backups, download
backup packages, or restore the system. SQL functions independently enforce this.

## Setup

1. Apply `supabase/migrations/0105_system_backup_restore.sql` in Supabase SQL Editor.
   This adds control tables, maintenance guards and Super Admin RPCs without
   changing business records. Apply it after the existing migrations.
2. Install PostgreSQL 18 client tools (`pg_dump` and `psql`). They must be at least
   as recent as the hosted server. Docker is not required by this implementation.
3. Keep the existing `BACKUP_DATABASE_URL` Session pooler URI, Supabase project URL,
   publishable key and server secret key in the server/worker environment.
4. Run `npm run backup:setup`. It creates `BACKUP_ENCRYPTION_KEY` in your ignored
   `.env` if absent. Keep a separate secure copy of that key: an encrypted backup
   cannot be recovered without it. Restart Next.js after adding environment values.
5. Run `npm run backup:worker` on the computer/server that will perform backups.

Optional server/worker settings:

```dotenv
# Absolute paths if PostgreSQL tools are not on PATH:
BACKUP_PG_DUMP_PATH="C:/Program Files/PostgreSQL/18/bin/pg_dump.exe"
BACKUP_PSQL_PATH="C:/Program Files/PostgreSQL/18/bin/psql.exe"
# Persistent storage shared by Next.js and the backup worker:
BACKUP_DIRECTORY="D:/IDRMM-Backups"
# Supabase root CA downloaded from Database Settings > SSL Configuration:
BACKUP_SSL_CA_FILE="C:/Users/HP-Victus/.idrmm/supabase-ca.crt"
BACKUP_TIMEZONE="Asia/Manila"
BACKUP_HOUR="2"
BACKUP_SCHEDULE_DISABLED="false"
```

Without `BACKUP_DIRECTORY`, packages are stored beneath the operating-system
user's home directory at `.idrmm/backups/<project-ref>`, outside this repository
and outside the hosted Supabase database. Keep a downloaded copy on another
protected device/location. No automatic deletion/retention cleanup is enabled.
The Next.js server and worker must share this persistent directory. A stateless
hosting instance with no shared disk needs an external artifact-store adapter
before this worker can be deployed there.

Native tools use verified TLS and a temporary password file rather than putting
the connection string on their command line. PostgreSQL 18 can use system root
certificates; supply the Supabase CA file if your machine does not trust the
certificate chain. Do not disable certificate verification.
`SELF_SIGNED_CERT_IN_CHAIN` means that the worker needs the Supabase root CA in
`BACKUP_SSL_CA_FILE`. Keep the file in a permanent location and restart the worker.

## Daily operation

The worker runs once per local calendar day from the configured hour onward.
Starting it later that day catches up that day's backup. It cannot back up while
the computer is off. Scheduling is not continuous or per-entry recovery.

In Settings, **Back up now** queues a manual backup. The worker waits for current
saves, temporarily blocks database/attachment writes, exports consistent public
and Auth table data, schema/recovery metadata and migrations, copies all Storage
files, encrypts the package with AES-256-GCM, then decrypts it and verifies every
member's hash. Only verified packages enter Backup history. Reads remain available
except during the short database restore transaction. Do not close/kill the
worker during an operation. Wait until the job finishes before stopping it;
interrupting a restore can require recovery before users can save again.

Failed exports are never listed as usable backups. Backups do not contain the
application `.env`, the encryption key, database connection password, platform
SMTP/provider settings or external service configuration. Retain those settings
separately. Included Auth database data and application records are encrypted.

## Restore

1. Choose a verified snapshot in Settings and type its displayed confirmation.
2. The worker checks the encrypted package, source project, key, schema fingerprint
   and that the requesting Super Admin exists in that backup.
3. A separate safety snapshot of the current system is created and verified.
4. The worker loads the SQL dump into typed temporary staging tables and checks
   counts before replacing records. It restores managed Auth rows in dependency
   order, replaces generated default profiles with the saved account records,
   and validates all foreign keys before restoring their original settings.
   Application triggers are paused only inside that transaction and restored
   to their original states. This does not require the unavailable hosted
   `session_replication_role` privilege. It also restores sequences and invalidates
   old login sessions.
   During that locked transaction, the application's account-registration hook
   accepts only the worker's private recovery lease instead of requiring new
   invitations for saved accounts. Its exact original definition is restored
   before commit; rollback also restores the original invitation checks.
5. It restores bucket settings and file bytes through Supabase Storage APIs,
   verifies downloaded bytes, and removes files/buckets created after the snapshot.
6. Writes reopen only after verification. Sign in again using the credentials
   that existed at the backup date, or use the existing password-reset process.

Table data is restored transactionally. PostgreSQL sequence counters and Storage
files do not share that rollback boundary. This is why any failure after restore
starts keeps maintenance enabled until a compatible snapshot is recovered.

Automatic restore is intentionally **same-project, same-schema data recovery**.
It does not silently roll back migrations or recreate Supabase-managed schemas.
Packages include `database/schema.sql`, managed customization metadata and the
repository's migration files for developer-led schema/disaster recovery.
Follow Supabase's backup/migration documentation for rebuilding another project;
platform settings, keys, extensions and URL changes need separate handling.

If a restore fails after data changes begin, writes remain locked and the worker
reports recovery required. Restart the worker and restore the safety snapshot or
another compatible verified backup. It does not silently continue normal writes.

## Recovery when the web interface is unavailable

Keep the encryption key, server credentials and an encrypted package outside the
primary database. Import a downloaded package on the recovery computer:

```powershell
npm run backup:worker -- --import "D:/Secure/IDRMM-backup-<snapshot-id>.idrmm"
```

This verifies/registers the package; it does not restore records. An operator with
the protected database credentials can then initiate offline recovery explicitly:

```powershell
npm run backup:worker -- --restore <snapshot-id> --confirm=RESTORE
```

Offline recovery still enforces project/key/schema compatibility and a safety
backup. Use `npm run backup:once` to process one already-queued operation without
enabling the daily scheduler. Never place downloaded packages or keys in Git.

## Validation before first real restore

Use a disposable local Supabase/PostgreSQL environment matching the deployed
schema. Test a backup and restore including accounts, grants, progress quantities,
expense totals, archived projects, sequences and actual attachment bytes. Test
wrong keys, corruption, missing files, interrupted workers and failures after SQL
restore. Do not use the production database as the first restore test.
For a local Supabase drill, both the API URL and database host must be loopback
addresses (localhost, 127.0.0.1 or ::1). Only that local combination disables TLS;
hosted database connections always verify their certificates. Use separate local
environment values and a separate backup directory for the drill.

On Windows with the PostgreSQL server binaries installed, the native database
drill creates and removes its own isolated local cluster with password
authentication. It does not connect to the hosted application database:

```powershell
$env:RUN_BACKUP_NATIVE_TESTS="1"
node --test scripts/backup-native.test.mjs
Remove-Item Env:RUN_BACKUP_NATIVE_TESTS
```

References:
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/storage/schema/design
- https://www.postgresql.org/docs/current/app-pgdump.html
- https://github.com/supabase/storage/blob/master/src/internal/database/postgres/scope.ts
