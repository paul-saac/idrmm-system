import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAGIC = Buffer.from('IDRMMBK1');
const MAX_PAYLOAD = 5 * 1024 ** 3;

export function backupConfig(env = process.env) {
  let db, api, project;
  try { db = new URL(env.BACKUP_DATABASE_URL); api = new URL(env.NEXT_PUBLIC_SUPABASE_URL); project = api.hostname.split('.')[0]; } catch { throw new Error('Configure BACKUP_DATABASE_URL and the Supabase project URL.'); }
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
  const local = loopback.has(db.hostname) && loopback.has(api.hostname);
  if (local) project = `local${api.port || '80'}${db.port || '5432'}`;
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.password || db.hash || !/^[a-z0-9]+$/.test(project)) throw new Error('The backup database URL is invalid.');
  if (!local && decodeURIComponent(db.username) !== `postgres.${project}` && !(db.hostname === `db.${project}.supabase.co` && db.username === 'postgres')) throw new Error('The backup database URL must belong to this Supabase project.');
  if (db.hostname.endsWith('.pooler.supabase.com') && db.port !== '5432') throw new Error('Use the Session pooler on port 5432 for backups.');
  const secret = env.BACKUP_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Run npm run backup:setup to create the backup encryption key.');
  const key = Buffer.from(secret, 'hex');
  return {
    db, project, key, local,
    keyId: createHash('sha256').update(key).digest('hex').slice(0, 16),
    directory: path.resolve(env.BACKUP_DIRECTORY || path.join(homedir(), '.idrmm', 'backups', project)),
    pgDump: env.BACKUP_PG_DUMP_PATH || 'pg_dump',
    psql: env.BACKUP_PSQL_PATH || 'psql',
    caFile: env.BACKUP_SSL_CA_FILE || '',
    schedule: env.BACKUP_SCHEDULE_DISABLED !== 'true',
    timeZone: env.BACKUP_TIMEZONE || 'Asia/Manila',
    hour: Number(env.BACKUP_HOUR ?? 2),
  };
}

export function artifactPath(directory, id) {
  if (!UUID.test(id)) throw new Error('Invalid backup ID.');
  return path.join(directory, `${id}.idrmm`);
}

export function safeMemberPath(root, relative) {
  if (!relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || path.posix.isAbsolute(relative) || relative.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Unsafe backup member path.');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Unsafe backup member path.');
  return target;
}

export async function removeWorkDirectory(root, target) {
  if (!path.resolve(target).startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid recovery working directory.');
  await rm(target, { recursive: true, force: true });
}

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function packageBackup(directory, output, metadata, key) {
  const entries = [];
  async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in backups.');
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), relative + '/');
      else {
        const file = safeMemberPath(directory, relative);
        entries.push({ path: relative, size: (await stat(file)).size, sha256: await hashFile(file) });
      }
    }
  }
  await walk(directory);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = { ...metadata, format: 1, entries };
  const json = Buffer.from(JSON.stringify(manifest));
  if (json.length > 10 * 1024 ** 2 || entries.length > 20000) throw new Error('The backup manifest is too large.');
  const length = Buffer.alloc(4); length.writeUInt32BE(json.length);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const handle = await open(output, 'wx', 0o600);
  await handle.write(Buffer.concat([MAGIC, iv])); await handle.close();
  async function* content() {
    yield length; yield json;
    for (const entry of entries) for await (const chunk of createReadStream(safeMemberPath(directory, entry.path))) yield chunk;
  }
  await pipeline(Readable.from(content()), createGzip(), cipher, createWriteStream(output, { flags: 'a', mode: 0o600 }));
  await appendFile(output, cipher.getAuthTag());
  return manifest;
}

export async function unpackBackup(input, destination, key) {
  const size = (await stat(input)).size;
  if (size < 40) throw new Error('The backup is incomplete.');
  const handle = await open(input, 'r');
  const header = Buffer.alloc(20), tag = Buffer.alloc(16);
  await handle.read(header, 0, 20, 0); await handle.read(tag, 0, 16, size - 16); await handle.close();
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('This is not an IDRMM backup.');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const payload = path.join(destination, '.payload');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
  decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
  let expanded = 0;
  const limit = new Transform({ transform(chunk, encoding, done) {
    expanded += chunk.length;
    done(expanded > MAX_PAYLOAD ? new Error('The backup exceeds the recovery size limit.') : null, chunk);
  } });
  // Authenticate the entire decrypted package before interpreting its manifest.
  try {
    await pipeline(createReadStream(input, { start: 20, end: size - 17 }), decipher, createGunzip(), limit, createWriteStream(payload, { flags: 'wx', mode: 0o600 }));
    const file = await open(payload, 'r');
    let manifest;
    try {
      const length = Buffer.alloc(4); await file.read(length, 0, 4, 0);
      const n = length.readUInt32BE();
      if (!n || n > 10 * 1024 ** 2 || n + 4 > expanded) throw new Error('Invalid backup manifest.');
      const json = Buffer.alloc(n); await file.read(json, 0, n, 4);
      manifest = JSON.parse(json.toString('utf8'));
      if (manifest.format !== 1 || !UUID.test(manifest.id) || !Array.isArray(manifest.entries) || manifest.entries.length > 20000) throw new Error('Invalid backup manifest.');
      let offset = n + 4;
      const paths = new Set();
      for (const entry of manifest.entries) {
        const target = safeMemberPath(destination, entry.path);
        if (entry.path === '.payload' || paths.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || offset + entry.size > expanded) throw new Error('Invalid backup member.');
        paths.add(entry.path);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        if (entry.size) await pipeline(createReadStream(payload, { start: offset, end: offset + entry.size - 1 }), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
        else { const empty = await open(target, 'wx', 0o600); await empty.close(); }
        if (await hashFile(target) !== entry.sha256) throw new Error('Backup integrity verification failed.');
        offset += entry.size;
      }
      if (offset !== expanded) throw new Error('Unexpected trailing backup data.');
    } finally { await file.close(); }
    await rm(payload);
    return manifest;
  } catch {
    await rm(payload, { force: true });
    throw new Error('The backup could not be verified. Check the encryption key and file integrity.');
  }
}

export async function readCertificate(config) {
  return config.caFile ? await readFile(config.caFile, 'utf8') : undefined;
}
