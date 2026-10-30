import { mkdir, readdir } from 'node:fs/promises';
import nextEnv from '@next/env';
import { backupConfig, UUID, removeWorkDirectory } from '../lib/backups/package.mjs';
import { connectDatabase, checkTools } from '../lib/backups/database.mjs';
import { prepareWorker, heartbeat, claimJob, executeJob, importBackup, publicWorkerError } from '../lib/backups/worker.mjs';
import path from 'node:path';

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
let client, timer, stopping = false, prepared = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
try {
  const config = backupConfig();
  if (!Number.isInteger(config.hour) || config.hour < 0 || config.hour > 23) throw new Error('BACKUP_HOUR must be between 0 and 23.');
  new Intl.DateTimeFormat('en', { timeZone: config.timeZone });
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error('Configure SUPABASE_SECRET_KEY for attachment backups.');
  // Preflight runs before connecting, so a missing tool never creates a job.
  await checkTools(config);
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  client = await connectDatabase(config);
  client.on('error', () => { stopping = true; console.error('The database connection was lost. Restart the backup worker and review recovery status.'); });
  await prepareWorker(client, config);
  prepared = true;
  const root = path.join(config.directory, '.work');
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^(backup|verify|restore|import)-[A-Za-z0-9]+$/.test(entry.name)) await removeWorkDirectory(root, path.join(root, entry.name));
  }
  const args = process.argv.slice(2);
  const importAt = args.indexOf('--import');
  if (importAt >= 0) {
    if (!args[importAt + 1]) throw new Error('Supply the encrypted backup file after --import.');
    const id = await importBackup(client, config, path.resolve(args[importAt + 1]));
    console.log(`Verified and imported backup ${id}. No database records were restored.`);
  } else {
    const restoreAt = args.indexOf('--restore');
    if (restoreAt >= 0) {
      const id = args[restoreAt + 1];
      if (!UUID.test(id || '') || !args.includes('--confirm=RESTORE')) throw new Error('Offline recovery requires --restore SNAPSHOT_ID --confirm=RESTORE.');
      await client.query("insert into public.system_backup_jobs(kind,requested_by_name,snapshot_id) values('restore','Offline recovery operator',$1)", [id]);
    }
    timer = setInterval(() => { heartbeat(client, config).catch(() => { stopping = true; }); }, 10000);
    console.log('Backup worker started. It only processes confirmed requests and scheduled backups.');
    do {
      const job = await claimJob(client, config, !args.includes('--once') && restoreAt < 0);
      if (job) {
        await executeJob(client, config, job);
        console.log(`Operation ${job.id} finished. Check Backup & Restore for its result.`);
      }
      if (args.includes('--once') || restoreAt >= 0 || stopping) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    } while (!stopping);
  }
} catch (error) {
  console.error(publicWorkerError(error));
  process.exitCode = 1;
} finally {
  if (timer) clearInterval(timer);
  if (client) {
    try { if (prepared) await client.query('update public.system_backup_state set worker_ready=false where singleton'); } catch { /* Preserve maintenance on a lost connection. */ }
    await client.end().catch(() => {});
  }
}
