import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { artifactPath, backupConfig, packageBackup, unpackBackup, safeMemberPath, removeWorkDirectory } from './package.mjs';
import { dailyScheduleKey, publicWorkerError } from './worker.mjs';
import { toolEnvironment, runTool } from './database.mjs';

test('encrypted packages round-trip binary attachments and SQL without exposing plaintext', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'idrmm-package-test-'));
  try {
    const source = path.join(root, 'source'); await mkdir(path.join(source, 'database'), { recursive: true });
    await mkdir(path.join(source, 'storage'));
    const text = "COPY public.projects FROM stdin;\nPrivate construction information\n";
    const bytes = randomBytes(200000);
    await writeFile(path.join(source, 'database/data.sql'), text);
    await writeFile(path.join(source, 'storage/00000000.bin'), bytes);
    await writeFile(path.join(source, 'storage/00000001.bin'), '');
    const key = randomBytes(32), output = path.join(root, 'backup.idrmm'), id = randomUUID();
    await packageBackup(source, output, { id, project: 'testproject' }, key);
    assert.equal((await readFile(output)).includes(Buffer.from('Private construction')), false);
    const manifest = await unpackBackup(output, path.join(root, 'recovered'), key);
    assert.equal(manifest.id, id);
    assert.equal(await readFile(path.join(root, 'recovered/database/data.sql'), 'utf8'), text);
    assert.deepEqual(await readFile(path.join(root, 'recovered/storage/00000000.bin')), bytes);
    assert.equal((await stat(path.join(root, 'recovered/storage/00000001.bin'))).size, 0);
    await assert.rejects(unpackBackup(output, path.join(root, 'wrong-key'), randomBytes(32)), /could not be verified/);
    const corrupt = await readFile(output); corrupt[50] ^= 1;
    await writeFile(path.join(root, 'corrupt.idrmm'), corrupt);
    await assert.rejects(unpackBackup(path.join(root, 'corrupt.idrmm'), path.join(root, 'corrupt-output'), key), /could not be verified/);
    await assert.rejects(stat(path.join(root, 'corrupt-output/database/data.sql')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('recovery rejects path traversal, Windows alternate streams and invalid snapshot IDs', async () => {
  const root = path.join(tmpdir(), 'idrmm-package-safe');
  for (const value of ['../secret', '/absolute', 'C:/secret', 'storage/../../secret', 'storage\\secret', 'storage/file:stream', 'storage//file', 'storage/./file', '\0']) assert.throws(() => safeMemberPath(root, value), /Unsafe/);
  assert.throws(() => artifactPath(root, '../secret'), /Invalid/);
  await assert.rejects(removeWorkDirectory(root, tmpdir()), /Invalid/);
});

test('backup configuration validates source project, port and key without returning credentials', () => {
  const env = { BACKUP_DATABASE_URL: 'postgresql://postgres.testproject:example@aws-example.pooler.supabase.com:5432/postgres', NEXT_PUBLIC_SUPABASE_URL: 'https://testproject.supabase.co', BACKUP_ENCRYPTION_KEY: 'a'.repeat(64) };
  assert.equal(backupConfig(env).project, 'testproject');
  assert.throws(() => backupConfig({ ...env, BACKUP_DATABASE_URL: env.BACKUP_DATABASE_URL.replace('5432', '6543') }), /Session pooler/);
  assert.throws(() => backupConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://anotherproject.supabase.co' }), /belong/);
  assert.throws(() => backupConfig({ ...env, BACKUP_ENCRYPTION_KEY: '' }), /backup:setup/);
  const local = backupConfig({ ...env, BACKUP_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:54322/postgres', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' });
  assert.equal(local.local, true);
  assert.equal(local.project, 'local5432154322');
  assert.equal(backupConfig(env).local, false);
  assert.throws(() => backupConfig({ ...env, BACKUP_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:54322/postgres' }), /belong/);
});

test('daily scheduling follows Asia/Manila and catches up only once that local date', () => {
  const config = { schedule: true, timeZone: 'Asia/Manila', hour: 2 };
  assert.equal(dailyScheduleKey(config, new Date('2026-10-28T17:59:00Z')), null);
  assert.equal(dailyScheduleKey(config, new Date('2026-10-28T18:00:00Z')), 'Asia/Manila/2026-10-29');
  assert.equal(dailyScheduleKey(config, new Date('2026-10-29T10:00:00Z')), 'Asia/Manila/2026-10-29');
  assert.equal(dailyScheduleKey({ ...config, schedule: false }), null);
});

test('certificate failures explain the required trusted CA configuration', () => {
  assert.match(publicWorkerError({code:'SELF_SIGNED_CERT_IN_CHAIN'}), /BACKUP_SSL_CA_FILE/);
});

test('native tooling uses a protected password file and suppresses tool stderr', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'idrmm-pg-env-'));
  try {
    const env = await toolEnvironment({ db: new URL('postgresql://postgres.testproject:test%3Avalue%5Cend@aws-test.pooler.supabase.com:5432/postgres'), caFile: '' }, directory);
    assert.equal(env.PGPASSWORD, '');
    assert.equal(env.PGSSLMODE, 'verify-full');
    assert.match(await readFile(env.PGPASSFILE, 'utf8'), /test\\:value\\\\end/);
    await assert.rejects(runTool(process.execPath, ['-e', 'console.error("private-row-secret");process.exit(1)']), error => !error.message.includes('private-row-secret') && /database tool failed/.test(error.message));
    await assert.rejects(runTool(process.execPath, ['-e', 'console.error("psql:recovery.sql:12: ERROR:  42501\\nprivate-row-secret");process.exit(1)', '--', '--set=VERBOSITY=sqlstate']), error => error.message.includes('SQLSTATE 42501') && !error.message.includes('private-row-secret'));
    assert.equal(publicWorkerError(new Error('postgresql://private:secret@example.test/db failed')).includes('private:secret'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
