import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import nextEnv from '@next/env';
import { backupConfig } from '../lib/backups/package.mjs';
import { checkTools } from '../lib/backups/database.mjs';

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
if (!process.env.BACKUP_ENCRYPTION_KEY) {
  if (!existsSync('.env')) throw new Error('Create your local .env before configuring backups.');
  const key = randomBytes(32).toString('hex');
  appendFileSync('.env', `\n# Backup encryption: retain a separate secure copy for disaster recovery.\nBACKUP_ENCRYPTION_KEY="${key}"\n`);
  process.env.BACKUP_ENCRYPTION_KEY = key;
  console.log('Created a backup encryption key in .env. Its value is not displayed. Retain a secure copy separately from the backups.');
}
try {
  const config = backupConfig();
  console.log('Backup connection and encryption settings are configured.');
  await checkTools(config);
  console.log('PostgreSQL client tools were found. Apply migration 0105, then run npm run backup:worker.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backup setup needs attention.');
  console.error('Install PostgreSQL 18 client tools. If they are not on PATH, set BACKUP_PG_DUMP_PATH and BACKUP_PSQL_PATH in .env.');
  process.exitCode = 1;
}
