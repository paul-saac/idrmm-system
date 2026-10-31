import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const launcher = path.join(root, 'App_Data/jobs/continuous/idrmm-backup/run.sh');
// Exercise the real Linux launcher with version-only fake tools. --check never
// loads the worker or connects to Supabase; credentials below are fictional.
async function check(overrides = {}) {
  const tools = await mkdtemp(path.join(tmpdir(), 'idrmm-backup-tools-'));
  try {
    for (const name of ['pg_dump', 'psql']) {
      const file = path.join(tools, name);
      await writeFile(file, `#!/bin/sh\nprintf '${name} (PostgreSQL) 18.0\\n'\n`);
      await chmod(file, 0o700);
    }
    return spawnSync('bash', [launcher, '--check'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: {
        ...process.env,
        IDRMM_BACKUP_APP_ROOT: root,
        NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        BACKUP_DATABASE_URL: 'postgresql://postgres.abcdefghijklmnopqrst:fictional@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
        SUPABASE_SECRET_KEY: 'fictional-server-key',
        BACKUP_DIRECTORY: '/home/idrmm-backups',
        BACKUP_SSL_CA_FILE: path.join(root, 'App_Data/jobs/continuous/idrmm-backup/supabase-ca.crt'),
        BACKUP_PG_DUMP_PATH: path.join(tools, 'pg_dump'),
        BACKUP_PSQL_PATH: path.join(tools, 'psql'),
        ...overrides,
      },
    });
  } finally { await rm(tools, { recursive: true, force: true }); }
}

test('Linux deployment preflight passes without connecting or starting the worker', { skip: process.platform !== 'linux' }, async () => {
  const result = await check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /environment checks passed/);
  assert.doesNotMatch(result.stdout, /Backup worker started/);
});

test('missing shared directory fails before claiming a backup or installing tools', { skip: process.platform !== 'linux' }, async () => {
  const result = await check({ BACKUP_DIRECTORY: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Set BACKUP_DIRECTORY/);
});

test('Windows native-tool paths fail with an actionable message', { skip: process.platform !== 'linux' }, async () => {
  const result = await check({ BACKUP_PG_DUMP_PATH: 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Remove the Windows path/);
  assert.doesNotMatch(result.stderr, /fictional-server-key|postgresql:\/\//);
});

test('a missing certificate stops startup without relaxing TLS', { skip: process.platform !== 'linux' }, async () => {
  const result = await check({ BACKUP_SSL_CA_FILE: '/nonexistent-idrmm-ca.crt' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
});
