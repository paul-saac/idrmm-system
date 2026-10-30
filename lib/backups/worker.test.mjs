import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { publicWorkerError } from './worker.mjs';

// Exercise the actual orchestration function while isolating disk, native
// tools and Supabase APIs. These tests never connect to a database.
const source = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export async function executeJob('), source.indexOf('export async function prepareWorker(')).replace('export ', '');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function run({ fail, recovering = false, revoked = false } = {}) {
  const events = [];
  let recoveryState, outcome;
  const manifest = { recoveryAdminIds: ['actor'], database: { fingerprint: 'same', tables: [{ schema: 'public', name: 'projects' }] }, counts: { 'public.projects': '1' } };
  const client = { async query(sql, values) {
    if (sql.startsWith('select id from public.profiles')) return { rows: revoked ? [] : [{ id: 'actor' }] };
    if (sql.includes('select * from public.system_backup_state')) return { rows: [{ recovery_required: recovering }] };
    if (sql.includes('pg_advisory_unlock')) events.push('unlock');
    if (sql.includes("status='failed'")) outcome = 'failed';
    if (sql.includes("status='completed'")) outcome = 'completed';
    if (sql.startsWith('update public.system_backup_state set maintenance=$1')) recoveryState = values[0];
    if (sql.startsWith('update public.system_backup_state set maintenance=false')) recoveryState = false;
    return { rows: [] };
  } };
  const execute = new Function('randomBytes','sha','publicWorkerError','workDirectory','readVerifiedSnapshot','describeDatabase','captureBackup','restoreDatabase','restoreStorage','countTables','removeWorkDirectory', `${body};return executeJob;`)(
    randomBytes, sha, publicWorkerError,
    async () => ({ root: 'work', directory: 'work/restore' }),
    async () => { events.push('validate'); if (fail === 'package') throw new Error('Corrupt package'); return manifest; },
    async () => ({ fingerprint: fail === 'schema' ? 'different' : 'same' }),
    async () => { events.push('safety'); if (fail === 'safety') throw new Error('Safety backup failed'); return 'safety-id'; },
    async () => { events.push('database'); if (fail === 'database') throw new Error('SQL restore failed'); },
    async () => { events.push('files'); if (fail === 'files') throw new Error('File restore failed'); },
    async () => ({ 'public.projects': fail === 'counts' ? '2' : '1' }),
    async () => { events.push('cleanup'); },
  );
  await execute(client, {}, { id: 'job', kind: 'restore', requested_by: 'actor', snapshot_id: 'snapshot' });
  return { events, recoveryState, outcome };
}

test('restore verifies a safety copy before changing database or attachment data', async () => {
  const result = await run();
  assert.deepEqual(result.events, ['validate', 'safety', 'database', 'files', 'cleanup', 'unlock']);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.recoveryState, false);
});

test('invalid packages, schema mismatch and failed safety backups prevent destructive restoration', async () => {
  for (const fail of ['package', 'schema', 'safety']) {
    const result = await run({ fail });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.events.includes('database'), false);
    assert.equal(result.recoveryState, false);
    assert.equal(result.events.at(-1), 'unlock');
  }
});

test('SQL, file and final verification failures keep recovery locked', async () => {
  for (const fail of ['database', 'files', 'counts']) {
    const result = await run({ fail });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.recoveryState, true);
    assert.equal(result.events.at(-1), 'unlock');
  }
});

test('retrying recovery preserves the original safety backup and stays locked on validation failure', async () => {
  const recovered = await run({ recovering: true });
  assert.equal(recovered.outcome, 'completed');
  assert.equal(recovered.events.includes('safety'), false);
  assert.equal(recovered.recoveryState, false);
  assert.equal((await run({ recovering: true, fail: 'package' })).recoveryState, true);
});

test('revoked requesters cannot acquire a recovery lease or clear existing maintenance', async () => {
  const result = await run({ revoked: true, recovering: true });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.recoveryState, undefined);
  assert.deepEqual(result.events, []);
});
