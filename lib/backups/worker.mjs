import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, stat, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { artifactPath, hashFile, packageBackup, unpackBackup, removeWorkDirectory, safeMemberPath, UUID } from './package.mjs';
import { connectDatabase, describeDatabase, countTables, exportDatabase, restoreDatabase, checkTools, nativeServerVersion } from './database.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const actorName = job => job.requested_by_name || 'Scheduled backup';
export function publicWorkerError(error) {
  if (['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error?.code)) return 'The database certificate could not be verified. Download the Supabase root CA from Database Settings > SSL Configuration, set BACKUP_SSL_CA_FILE to its file path, then restart the worker.';
  if (error?.code === '28P01') return 'The database password was rejected. Check BACKUP_DATABASE_URL.';
  if (error?.code) return `Database or network operation failed (${String(error.code).replace(/[^A-Z0-9_]/gi, '').slice(0, 30)}). Check the worker configuration.`;
  return error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[private connection]').slice(0, 400) : 'The backup operation failed.';
}

export function storageClient(config, token) {
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error('Configure the server-side Supabase secret key.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-idrmm-recovery-token': token } },
  });
}

async function workDirectory(config, prefix) {
  const root = path.join(config.directory, '.work');
  await mkdir(root, { recursive: true, mode: 0o700 });
  return { root, directory: await mkdtemp(path.join(root, prefix)) };
}

async function registerSnapshot(client, manifest, config, file) {
  const size = (await stat(file)).size, digest = await hashFile(file);
  await client.query(`insert into public.system_backup_snapshots(id,created_at,created_by,created_by_name,purpose,size_bytes,artifact_sha256,key_id,schema_fingerprint,table_count,file_count,recovery_admin_ids)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(id) do nothing`,
  [manifest.id, manifest.createdAt, manifest.actorId, manifest.actorName, manifest.purpose, size, digest, config.keyId, manifest.database.fingerprint, manifest.database.tables.length, manifest.storage.objects.length, manifest.recoveryAdminIds]);
  return manifest.id;
}

async function readVerifiedSnapshot(client, config, id, destination) {
  const snapshot = (await client.query('select * from public.system_backup_snapshots where id=$1', [id])).rows[0];
  if (!snapshot) throw new Error('Backup not found.');
  if (snapshot.key_id !== config.keyId) throw new Error('This backup needs a different encryption key.');
  const file = artifactPath(config.directory, id);
  if ((await lstat(file)).isSymbolicLink() || await hashFile(file) !== snapshot.artifact_sha256) throw new Error('The backup file failed integrity verification.');
  const manifest = await unpackBackup(file, destination, config.key);
  validateSnapshot(manifest, config);
  if (manifest.id !== id) throw new Error('The backup ID does not match its record.');
  return manifest;
}

export function validateSnapshot(manifest, config) {
  if (!UUID.test(manifest.id) || manifest.project !== config.project || !Array.isArray(manifest.database?.tables) || !manifest.database.tables.length || !manifest.counts || !Array.isArray(manifest.recoveryAdminIds) || !manifest.recoveryAdminIds.every(id => UUID.test(id))) throw new Error('Invalid backup manifest or source project.');
  const { tables, policies, functions, triggers, enums, sequences, fingerprint } = manifest.database;
  if (sha(JSON.stringify({ tables, policies, functions, triggers, enums, sequences })) !== fingerprint) throw new Error('The backup schema manifest is inconsistent.');
  const names = new Set();
  for (const table of tables) {
    const name = `${table.schema}.${table.name}`;
    if (!['public','auth'].includes(table.schema) || typeof table.name !== 'string' || table.name.startsWith('system_backup_') || (table.schema === 'auth' && table.name === 'schema_migrations') || names.has(name) || !/^\d+$/.test(manifest.counts[name])) throw new Error('Invalid backup table inventory.');
    names.add(name);
  }
  const members = new Map(manifest.entries.map(entry => [entry.path, entry]));
  for (const required of ['database/data.sql','database/schema.sql','database/sequences.sql']) if (!members.has(required)) throw new Error('The backup database files are incomplete.');
  if (!Array.isArray(manifest.storage?.buckets) || !Array.isArray(manifest.storage?.objects)) throw new Error('Invalid backup file inventory.');
  const objects = new Set();
  for (const object of manifest.storage.objects) {
    const name = `${object.bucket_id}\0${object.name}`, member = members.get(object.member);
    if (typeof object.name !== 'string' || typeof object.bucket_id !== 'string' || !manifest.storage.buckets.some(bucket => bucket.id === object.bucket_id) || objects.has(name) || !/^storage\/\d{8}\.bin$/.test(object.member) || !member || member.sha256 !== object.sha256 || member.size !== object.size) throw new Error('The backup attachment inventory is inconsistent.');
    objects.add(name);
  }
}

export async function captureBackup(client, config, job, token, purpose, phase = async () => {}) {
  const work = await workDirectory(config, 'backup-');
  let snapshotClient;
  try {
    await phase('Exporting database');
    // Auth can refresh sessions independently of application writes. Export
    // counts and data from the same PostgreSQL snapshot, not separate reads.
    snapshotClient = await connectDatabase(config);
    await snapshotClient.query('begin isolation level repeatable read read only');
    const snapshotId = (await snapshotClient.query('select pg_export_snapshot() as id')).rows[0].id;
    const database = await describeDatabase(snapshotClient);
    if (database.tables.some(t => t.schema === 'public' && !t.guarded)) throw new Error('A project table is missing its maintenance guard. Update the backup migration before backing up.');
    const counts = await countTables(snapshotClient, database.tables);
    const recoveryAdminIds = (await snapshotClient.query("select p.id from public.profiles p join auth.users u on u.id=p.id where p.role='super_admin' and p.status='active' and not p.invitation_pending order by p.id")).rows.map(r => r.id);
    if (!recoveryAdminIds.length) throw new Error('At least one accepted active Super Administrator is required in a backup.');
    const dbDirectory = path.join(work.directory, 'database');
    await mkdir(dbDirectory);
    const objects = (await snapshotClient.query('select bucket_id,name,metadata from storage.objects order by bucket_id,name')).rows;
    await exportDatabase(snapshotClient, config, dbDirectory, database, snapshotId);
    await snapshotClient.query('commit');
    await snapshotClient.end(); snapshotClient = null;
    const migrationsDirectory = path.resolve('supabase', 'migrations');
    await mkdir(path.join(work.directory, 'migrations'));
    for (const name of (await readdir(migrationsDirectory)).filter(n => /^\d+_[a-z0-9_]+\.sql$/i.test(n)).sort()) {
      await copyFile(path.join(migrationsDirectory, name), path.join(work.directory, 'migrations', name));
    }
    await phase('Copying uploaded files');
    const storage = storageClient(config, token);
    const { data: buckets, error: bucketError } = await storage.storage.listBuckets();
    if (bucketError || !buckets) throw new Error('Could not read the Storage buckets.');
    await mkdir(path.join(work.directory, 'storage'));
    for (let index = 0; index < objects.length; index++) {
      const object = objects[index];
      const { data, error } = await storage.storage.from(object.bucket_id).download(object.name);
      if (error || !data) throw new Error('Could not download an attachment. This backup is incomplete.');
      const bytes = Buffer.from(await data.arrayBuffer());
      object.member = `storage/${String(index).padStart(8, '0')}.bin`;
      object.sha256 = sha(bytes);
      object.size = bytes.length;
      await writeFile(path.join(work.directory, object.member), bytes, { mode: 0o600 });
    }
    const id = randomUUID(), file = artifactPath(config.directory, id);
    await phase('Encrypting and verifying backup');
    const metadata = { id, createdAt: new Date().toISOString(), project: config.project, purpose, actorId: job.requested_by, actorName: actorName(job), database, counts, recoveryAdminIds, storage: { buckets, objects } };
    await packageBackup(work.directory, file, metadata, config.key);
    const verify = await workDirectory(config, 'verify-');
    try {
      const checked = await unpackBackup(file, verify.directory, config.key);
      if (checked.id !== id || checked.project !== config.project) throw new Error('The backup could not be verified.');
    } finally { await removeWorkDirectory(verify.root, verify.directory); }
    // A package is never registered as restorable until authentication and
    // every member hash have been checked through a full decrypt/extract.
    return await registerSnapshot(client, metadata, config, file);
  } finally {
    try { if (snapshotClient) await snapshotClient.end(); }
    finally { await removeWorkDirectory(work.root, work.directory); }
  }
}

async function restoreStorage(client, config, token, manifest, directory) {
  const storage = storageClient(config, token);
  const { data: existing, error } = await storage.storage.listBuckets();
  if (error) throw new Error('Could not inspect Storage before restoration.');
  const existingIds = new Set((existing || []).map(b => b.id));
  for (const bucket of manifest.storage.buckets) {
    const options = { public: bucket.public, allowedMimeTypes: bucket.allowed_mime_types, fileSizeLimit: bucket.file_size_limit };
    const result = existingIds.has(bucket.id)
      ? await storage.storage.updateBucket(bucket.id, options)
      : await storage.storage.createBucket(bucket.id, options);
    if (result.error) throw new Error('Could not restore a Storage bucket configuration.');
  }
  const wanted = new Set(manifest.storage.objects.map(o => `${o.bucket_id}\0${o.name}`));
  for (const object of manifest.storage.objects) {
    const bytes = await readFile(safeMemberPath(directory, object.member));
    const result = await storage.storage.from(object.bucket_id).upload(object.name, bytes, { upsert: true, contentType: object.metadata?.mimetype || 'application/octet-stream', cacheControl: String(object.metadata?.cacheControl || '3600') });
    if (result.error) throw new Error('Could not restore an attachment. Recovery remains locked until all files are restored.');
    const downloaded = await storage.storage.from(object.bucket_id).download(object.name);
    if (downloaded.error || !downloaded.data || sha(Buffer.from(await downloaded.data.arrayBuffer())) !== object.sha256) throw new Error('Restored attachment verification failed.');
  }
  // Use Storage APIs for metadata/bytes together; never delete storage.objects
  // directly. The safety snapshot contains files created after this snapshot.
  const current = (await client.query('select bucket_id,name from storage.objects order by bucket_id,name')).rows;
  for (const bucket of existing || []) {
    const extra = current.filter(o => o.bucket_id === bucket.id && !wanted.has(`${o.bucket_id}\0${o.name}`)).map(o => o.name);
    for (let index = 0; index < extra.length; index += 100) {
      if ((await storage.storage.from(bucket.id).remove(extra.slice(index, index + 100))).error) throw new Error('Could not reconcile restored attachments.');
    }
    if (!manifest.storage.buckets.some(b => b.id === bucket.id) && (await storage.storage.deleteBucket(bucket.id)).error) throw new Error('Could not reconcile restored Storage buckets.');
  }
}

export async function executeJob(client, config, job) {
  const token = randomBytes(32).toString('hex');
  let locked = false, destructive = false, recovering = false;
  let work;
  const phase = async text => { await client.query('update public.system_backup_jobs set phase=$2 where id=$1', [job.id, text]); };
  try {
    if (job.requested_by) {
      const actor = (await client.query("select id from public.profiles where id=$1 and role='super_admin' and status='active' and not invitation_pending", [job.requested_by])).rows[0];
      if (!actor) throw new Error('The requesting Super Administrator no longer has access.');
    } else if (job.kind !== 'backup' && job.requested_by_name !== 'Offline recovery operator') throw new Error('A restore needs an authorized operator.');
    await phase('Waiting for current saves');
    await client.query('select pg_advisory_lock(18244,7291)'); locked = true;
    const state = (await client.query('select * from public.system_backup_state where singleton')).rows[0];
    recovering = state.recovery_required;
    if (recovering && job.kind !== 'restore') throw new Error('Recovery is required before another backup can be made.');
    await client.query('update public.system_backup_state set maintenance=true,active_job_id=$1,recovery_token_hash=$2 where singleton', [job.id, sha(token)]);
    if (job.kind === 'backup') {
      const id = await captureBackup(client, config, job, token, job.schedule_key ? 'scheduled' : 'manual', phase);
      await client.query('update public.system_backup_jobs set snapshot_id=$2 where id=$1', [job.id, id]);
    } else {
      await phase('Validating recovery package');
      work = await workDirectory(config, 'restore-');
      const manifest = await readVerifiedSnapshot(client, config, job.snapshot_id, work.directory);
      if (job.requested_by && !manifest.recoveryAdminIds.includes(job.requested_by)) throw new Error('This backup does not contain your active Super Administrator account.');
      const current = await describeDatabase(client);
      if (current.fingerprint !== manifest.database.fingerprint) throw new Error('The database structure differs from this backup. Automatic restore requires the same schema version.');
      if (!recovering) {
        const safety = await captureBackup(client, config, job, token, 'safety', phase);
        await client.query('update public.system_backup_jobs set safety_snapshot_id=$2 where id=$1', [job.id, safety]);
      }
      await phase('Restoring database');
      destructive = true;
      await restoreDatabase(client, config, work.directory, manifest, token);
      await phase('Restoring and verifying attachments');
      await restoreStorage(client, config, token, manifest, work.directory);
      const counts = await countTables(client, manifest.database.tables.filter(t => t.schema === 'public' || (t.schema === 'auth' && ['users','identities','mfa_factors'].includes(t.name))));
      if (Object.entries(counts).some(([table, count]) => manifest.counts[table] !== count)) throw new Error('Restored record counts do not match the selected backup.');
    }
    await client.query("update public.system_backup_jobs set status='completed',phase='Completed',finished_at=now() where id=$1", [job.id]);
    await client.query('update public.system_backup_state set maintenance=false,recovery_required=false,active_job_id=null,recovery_token_hash=null where singleton');
  } catch (error) {
    await client.query("update public.system_backup_jobs set status='failed',phase='Failed',error=$2,finished_at=now() where id=$1", [job.id, publicWorkerError(error)]);
    const needsRecovery = destructive || recovering;
    if (locked) await client.query('update public.system_backup_state set maintenance=$1,recovery_required=$1,active_job_id=case when $1 then active_job_id else null end,recovery_token_hash=null where singleton', [needsRecovery]);
  } finally {
    try { if (work) await removeWorkDirectory(work.root, work.directory); }
    finally { if (locked) await client.query('select pg_advisory_unlock(18244,7291)'); }
  }
}

export async function prepareWorker(client, config) {
  const acquired = (await client.query('select pg_try_advisory_lock(18244,7290) as acquired')).rows[0].acquired;
  if (!acquired) throw new Error('Another backup worker is already running.');
  const [dump, psql] = await checkTools(config);
  const server = await nativeServerVersion(client);
  if (!dump || dump < server || !psql || psql < server || dump < 17 || psql < 17) throw new Error('Install PostgreSQL 18 client tools, or a newer client version matching the database server.');
  const state = (await client.query('select * from public.system_backup_state where singleton')).rows[0];
  if (!state) throw new Error('Apply migration 0105 before starting the worker.');
  const running = (await client.query("select * from public.system_backup_jobs where status='running'")).rows;
  if (running.length) {
    const recovery = state.recovery_required || running.some(j => j.kind === 'restore');
    await client.query("update public.system_backup_jobs set status='failed',phase='Interrupted',finished_at=now(),error='The worker stopped during this operation. Restart the worker and review recovery status.' where status='running'");
    await client.query('update public.system_backup_state set maintenance=$1,recovery_required=$1,recovery_token_hash=null where singleton', [recovery]);
  }
  await heartbeat(client, config);
}

export async function heartbeat(client, config) {
  await client.query("update public.system_backup_state set worker_ready=true,worker_heartbeat=now(),worker_message='Worker ready',schedule_description=$1 where singleton", [config.schedule ? `Daily from ${String(config.hour).padStart(2, '0')}:00 ${config.timeZone} while the worker is running.` : 'Automatic scheduling is disabled.']);
}

export function dailyScheduleKey(config, now = new Date()) {
  if (!config.schedule) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type,p.value]));
  return Number(parts.hour) >= config.hour ? `${config.timeZone}/${parts.year}-${parts.month}-${parts.day}` : null;
}

export async function claimJob(client, config, schedule = true) {
  if (schedule) {
    const key = dailyScheduleKey(config);
    if (key) await client.query(`insert into public.system_backup_jobs(kind,requested_by_name,schedule_key)
      select 'backup','Scheduled backup',$1 where not exists(select 1 from public.system_backup_jobs where status in ('queued','running'))
      and not exists(select 1 from public.system_backup_state where maintenance) on conflict do nothing`, [key]);
  }
  return (await client.query("update public.system_backup_jobs set status='running',started_at=now(),phase='Starting' where id=(select id from public.system_backup_jobs where status='queued' order by requested_at for update skip locked limit 1) returning *")).rows[0];
}

export async function importBackup(client, config, source) {
  const work = await workDirectory(config, 'import-');
  try {
    const manifest = await unpackBackup(source, work.directory, config.key);
    validateSnapshot(manifest, config);
    const target = artifactPath(config.directory, manifest.id);
    if (path.resolve(source) !== path.resolve(target)) await copyFile(source, target, 1);
    return await registerSnapshot(client, manifest, config, target);
  } finally { await removeWorkDirectory(work.root, work.directory); }
}
