#!/usr/bin/env bash
# Azure manages this continuous job; keep the website's npm start unchanged.
set -euo pipefail

APP_ROOT="${IDRMM_BACKUP_APP_ROOT:-/home/site/wwwroot}"
cd "$APP_ROOT"
export BACKUP_PG_DUMP_PATH="${BACKUP_PG_DUMP_PATH:-/usr/lib/postgresql/18/bin/pg_dump}"
export BACKUP_PSQL_PATH="${BACKUP_PSQL_PATH:-/usr/lib/postgresql/18/bin/psql}"
export BACKUP_SSL_CA_FILE="${BACKUP_SSL_CA_FILE:-$APP_ROOT/App_Data/jobs/continuous/idrmm-backup/supabase-ca.crt}"

# Fail before installing tools, connecting, or claiming jobs. Never print secrets.
node --input-type=module <<'NODE'
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { backupConfig } from './lib/backups/package.mjs';
const config = backupConfig();
if (!process.env.SUPABASE_SECRET_KEY) throw new Error('Add SUPABASE_SECRET_KEY in Azure Environment variables.');
if (!process.env.BACKUP_DIRECTORY || !config.directory.startsWith('/home/') || config.directory.startsWith('/home/site/wwwroot/')) {
  throw new Error('Set BACKUP_DIRECTORY=/home/idrmm-backups in Azure for both the website and worker.');
}
for (const name of ['BACKUP_PG_DUMP_PATH', 'BACKUP_PSQL_PATH', 'BACKUP_SSL_CA_FILE']) {
  if (/^[a-z]:/i.test(process.env[name]) || process.env[name].includes('\\')) {
    throw new Error(`Remove the Windows path in ${name}; this worker runs on Linux.`);
  }
}
const certificate = new X509Certificate(await readFile(config.caFile));
if (!certificate.ca || Date.now() < Date.parse(certificate.validFrom) || Date.now() >= Date.parse(certificate.validTo)) {
  throw new Error('The configured Supabase root CA is not a currently valid CA certificate.');
}
NODE

if [[ ! -x "$BACKUP_PG_DUMP_PATH" || ! -x "$BACKUP_PSQL_PATH" ]]; then
  if [[ "$BACKUP_PG_DUMP_PATH" != /usr/lib/postgresql/18/bin/pg_dump || "$BACKUP_PSQL_PATH" != /usr/lib/postgresql/18/bin/psql ]]; then
    echo 'Configured PostgreSQL tools do not exist. Remove custom tool paths to use the managed Linux installation.' >&2
    exit 1
  fi
  bash "$APP_ROOT/App_Data/jobs/continuous/idrmm-backup/install-tools.sh"
fi

node --input-type=module <<'NODE'
import { backupConfig } from './lib/backups/package.mjs';
import { checkTools } from './lib/backups/database.mjs';
const versions = await checkTools(backupConfig());
if (versions.some(version => !Number.isInteger(version) || version < 18)) throw new Error('PostgreSQL 18 or newer client tools are required.');
console.log('Backup tools, certificate and environment checks passed.');
NODE

# Read-only deployment diagnostics: no connection, heartbeat, backup or restore.
if [[ "${1:-}" == --check ]]; then exit 0; fi
if [[ $# -ne 0 ]]; then echo 'Supported diagnostic option: --check' >&2; exit 1; fi

# exec lets Azure deliver shutdown signals to the worker, which finishes its job.
exec node scripts/backup-worker.mjs
