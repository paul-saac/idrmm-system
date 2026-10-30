import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import pg from 'pg';
import { readCertificate } from './package.mjs';

export const quoteId = value => '"' + String(value).replaceAll('"', '""') + '"';
const qualified = table => `${quoteId(table.schema)}.${quoteId(table.name)}`;
export const isRecoveryTable = (schema, name) => (schema === 'public' && !name.startsWith('system_backup_')) || (schema === 'auth' && name !== 'schema_migrations');

export async function connectDatabase(config) {
  const url = new URL(config.db);
  // Explicit TLS verification must not be overridden by URI convenience flags.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key);
  const client = new pg.Client({ connectionString: url.toString(), ssl: config.local ? false : { rejectUnauthorized: true, ca: await readCertificate(config) }, connectionTimeoutMillis: 10000, application_name: 'idrmm-backup-worker' });
  await client.connect();
  await client.query("set statement_timeout='120s'");
  return client;
}

export async function runTool(executable, args, env = {}, timeout = 1200000) {
  return new Promise((resolve, reject) => {
    let output = '', diagnostics = '';
    const child = spawn(executable, args, { shell: false, windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('The database tool timed out.')); }, timeout);
    child.stdout.on('data', data => { if (output.length < 4096) output += data.toString(); });
    // psql's sqlstate verbosity emits codes without row values or credentials.
    // Keep raw native diagnostics private; expose only a validated SQLSTATE.
    child.stderr.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-8192); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('PostgreSQL client tools are missing or cannot be started. Configure BACKUP_PG_DUMP_PATH and BACKUP_PSQL_PATH.')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const state = args.includes('--set=VERBOSITY=sqlstate') ? diagnostics.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\s|$)/)?.[1] : null;
        reject(new Error(`A database tool failed${state ? ` (SQLSTATE ${state})` : ''}. Check its version, database permissions, connection and SSL configuration.`));
      }
      else resolve(output.trim());
    });
  });
}

export async function checkTools(config) {
  const versions = await Promise.all([runTool(config.pgDump, ['--version'], {}, 10000), runTool(config.psql, ['--version'], {}, 10000)]);
  return versions.map(value => Number(value.match(/\b(\d+)\.\d+/)?.[1]));
}

export async function toolEnvironment(config, directory) {
  const value = input => decodeURIComponent(input).replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  if (/[\r\n]/.test(decodeURIComponent(config.db.password))) throw new Error('Database passwords with line breaks are not supported.');
  const passfile = path.join(directory, '.pgpass');
  await writeFile(passfile, [config.db.hostname, config.db.port || '5432', value(config.db.pathname.slice(1)), value(config.db.username), value(config.db.password)].join(':') + '\n', { mode: 0o600 });
  return {
    PGHOST: config.db.hostname, PGPORT: config.db.port || '5432', PGDATABASE: decodeURIComponent(config.db.pathname.slice(1)), PGUSER: decodeURIComponent(config.db.username),
    PGPASSFILE: passfile, PGPASSWORD: '', PGSSLMODE: config.local ? 'disable' : 'verify-full', PGSSLROOTCERT: config.local ? '' : config.caFile || 'system', PGCONNECT_TIMEOUT: '10', PGCLIENTENCODING: 'UTF8',
  };
}

export async function describeDatabase(client) {
  const tables = (await client.query(`select n.nspname as schema,c.relname as name,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
    exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='a_system_backup_write_guard') as guarded,
    (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
    (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid) as constraints,
    (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid) as indexes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind in ('r','p') and not c.relispartition
      and not exists(select 1 from pg_depend d where d.objid=c.oid and d.classid='pg_class'::regclass and d.deptype='e') order by n.nspname,c.relname`)).rows.filter(t => isRecoveryTable(t.schema, t.name));
  const policies = (await client.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','auth','storage') order by schemaname,tablename,policyname")).rows;
  const functions = (await client.query("select p.proname,p.proacl,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e') order by p.proname,p.oid::regprocedure::text")).rows;
  const triggers = (await client.query("select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','auth','storage') order by n.nspname,c.relname,t.tgname")).rows;
  const enums = (await client.query("select n.nspname,t.typname,array_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname in ('public','auth') group by n.nspname,t.typname order by n.nspname,t.typname")).rows;
  const sequences = (await client.query("select schemaname,sequencename,data_type,start_value::text,min_value::text,max_value::text,increment_by::text,cycle from pg_sequences where schemaname in ('public','auth') order by schemaname,sequencename")).rows;
  const schema = { tables, policies, functions, triggers, enums, sequences };
  return { ...schema, fingerprint: createHash('sha256').update(JSON.stringify(schema)).digest('hex') };
}

export async function countTables(client, tables) {
  const counts = {};
  for (const table of tables) counts[`${table.schema}.${table.name}`] = (await client.query(`select count(*)::text as count from ${qualified(table)}`)).rows[0].count;
  return counts;
}

export async function exportDatabase(client, config, directory, description, snapshotId) {
  const env = await toolEnvironment(config, directory);
  try {
    const tables = description.tables.map(t => `--table=${qualified(t)}`);
    if (!/^[a-f0-9-]+$/i.test(snapshotId || '')) throw new Error('A consistent database snapshot is required.');
    await runTool(config.pgDump, ['--data-only', '--no-owner', '--no-privileges', '--quote-all-identifiers', '--no-comments', `--snapshot=${snapshotId}`, ...tables, `--file=${path.join(directory, 'data.sql')}`], env);
    await runTool(config.pgDump, ['--schema-only', '--no-owner', '--quote-all-identifiers', '--schema=public', `--file=${path.join(directory, 'schema.sql')}`], env);
    await writeFile(path.join(directory, 'managed-customizations.json'), JSON.stringify({ policies: description.policies, triggers: description.triggers.filter(t => t.nspname !== 'public') }, null, 2), { mode: 0o600 });
    // Explicitly retain sequence state even when the selected-table dump does
    // not include an owned sequence on a particular PostgreSQL version.
    const sequences = (await client.query(`select n.nspname as schema,s.relname as name from pg_class s join pg_namespace n on n.oid=s.relnamespace
      where s.relkind='S' and n.nspname in ('public','auth') and s.relname not like 'system_backup_%' order by n.nspname,s.relname`)).rows;
    const statements = [];
    for (const sequence of sequences) {
      const state = (await client.query(`select last_value::text,is_called from ${qualified(sequence)}`)).rows[0];
      const literal = qualified(sequence).replaceAll("'", "''");
      if (!/^-?\d+$/.test(state.last_value)) throw new Error('Invalid sequence state.');
      statements.push(`select pg_catalog.setval('${literal}'::regclass,${state.last_value},${Boolean(state.is_called)});`);
    }
    await writeFile(path.join(directory, 'sequences.sql'), statements.join('\n'), { mode: 0o600 });
  } finally { await rm(path.join(directory, '.pgpass'), { force: true }); }
}

export function restorePrelude(tables, token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid recovery lease.');
  return `set local lock_timeout='15s';\nset local statement_timeout='20min';\nset local idrmm.recovery_token='${token}';\nlock table ${tables.map(qualified).join(',')} in access exclusive mode;\n${tables.map((t,i) => `create temp table ${stagingTable(i)} on commit drop as select * from ${qualified(t)} with no data;`).join('\n')}\n`;
}

const stagingTable = index => `pg_temp.${quoteId(`idrmm_restore_${index}`)}`;

// Retarget pg_dump COPY blocks into typed temporary tables. COPY payload lines
// are never interpreted as SQL. Sequence changes happen only after validation.
export async function stageDump(input, output, tables) {
  const targets = new Map(tables.map((table,index) => [qualified(table), stagingTable(index)]));
  const copied = new Set();
  async function* lines() {
    let copying = false;
    const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        if (copying) { yield line + '\n'; if (line === '\\.') copying = false; continue; }
        if (line.startsWith('COPY ')) {
          const target = [...targets.keys()].find(name => line.startsWith(`COPY ${name} (`));
          if (!target || !line.endsWith(' FROM stdin;') || copied.has(target)) throw new Error('Unexpected database COPY inventory in the backup.');
          copied.add(target); copying = true;
          yield `COPY ${targets.get(target)}${line.slice(5 + target.length)}\n`;
        } else if (!line.startsWith('SELECT pg_catalog.setval(')) yield line + '\n';
      }
      if (copying || copied.size !== tables.length) throw new Error('The backup database COPY inventory is incomplete.');
    } finally { reader.close(); }
  }
  await pipeline(Readable.from(lines()), createWriteStream(output, { flags: 'wx', mode: 0o600 }));
}

export async function restoreApplySql(client, manifest) {
  const tables = manifest.database.tables;
  const key = table => `${table.schema}.${table.name}`;
  const targets = new Set(tables.map(key));
  const foreignKeys = (await client.query(`select ns.nspname as schema,c.relname as name,k.conname,k.condeferrable,k.condeferred,
    nt.nspname as parent_schema,p.relname as parent_name from pg_constraint k
    join pg_class c on c.oid=k.conrelid join pg_namespace ns on ns.oid=c.relnamespace
    join pg_class p on p.oid=k.confrelid join pg_namespace nt on nt.oid=p.relnamespace where k.contype='f' order by ns.nspname,c.relname,k.conname`)).rows;
  if (foreignKeys.some(fk => targets.has(`${fk.parent_schema}.${fk.parent_name}`) && !targets.has(key(fk)))) throw new Error('A table outside the backup references restored data. Automatic recovery cannot safely truncate this schema.');
  const permissions = (await client.query(`select n.nspname as schema,c.relname as name,
    has_table_privilege(current_user,c.oid,'TRUNCATE') and has_table_privilege(current_user,c.oid,'INSERT') as writable,
    pg_has_role(current_user,c.relowner,'USAGE') as owned from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind in ('r','p')`)).rows;
  if (tables.some(t => !permissions.some(p => key(p) === key(t) && p.writable && (t.schema !== 'public' || p.owned)))) throw new Error('The database account lacks the table privileges required for recovery.');
  const triggers = (await client.query(`select n.nspname as schema,c.relname as name,t.tgname,t.tgenabled from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public' order by c.relname,t.tgname`)).rows.filter(t => targets.has(key(t)) && t.tgenabled !== 'D');
  // auth.users is managed by Supabase, so its trigger cannot be disabled by
  // the database login. Its application-owned invitation function can be
  // replaced transactionally while auth.users is exclusively locked. The
  // temporary body accepts only this worker's private maintenance lease;
  // restore the exact original definition before the transaction commits.
  const registrationHooks = targets.has('auth.users') ? (await client.query(`select pg_get_functiondef(p.oid) as definition,pg_has_role(current_user,p.proowner,'USAGE') as owned
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
    where not t.tgisinternal and n.nspname='auth' and c.relname='users' and pn.nspname='public'
      and p.proname='handle_new_user' and p.pronargs=0 and t.tgenabled in ('O','A')`)).rows : [];
  if (registrationHooks.some(hook => !hook.owned)) throw new Error('The application account-registration function needs owner permissions for recovery.');
  const recoveryRegistration = `create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public,pg_temp as $idrmm_registration$
    begin
      if not exists(select 1 from public.system_backup_state where singleton and maintenance
        and recovery_token_hash=encode(sha256(convert_to(nullif(current_setting('idrmm.recovery_token',true),''),'UTF8')),'hex')) then
        raise exception 'Account creation is paused during recovery.' using errcode='42501';
      end if;
      return new;
    end $idrmm_registration$;`;
  const auth = tables.filter(t => t.schema === 'auth'), ordered = [], inserted = new Set();
  while (auth.length) {
    const index = auth.findIndex(t => !foreignKeys.some(fk => key(fk) === key(t) && targets.has(`${fk.parent_schema}.${fk.parent_name}`) && !inserted.has(`${fk.parent_schema}.${fk.parent_name}`)));
    if (index < 0) throw new Error('Managed Auth tables have circular dependencies. This schema needs developer-led recovery.');
    const table = auth.splice(index,1)[0]; ordered.push(table); inserted.add(key(table));
  }
  const publicTables = tables.filter(t => t.schema === 'public');
  const constraints = foreignKeys.filter(fk => fk.schema === 'public' && targets.has(key(fk)));
  const insert = table => {
    const columns = table.columns.filter(c => !c[4]).map(c => quoteId(c[0])).join(',');
    return `insert into ${qualified(table)} (${columns}) overriding system value select ${columns} from ${stagingTable(tables.indexOf(table))};`;
  };
  const counts = tables.map((t,i) => {
    const expected = manifest.counts[key(t)];
    if (!/^\d+$/.test(expected)) throw new Error('Invalid table count.');
    return `if (select count(*) from ${stagingTable(i)})<>${expected} then raise exception 'Staged row counts do not match the backup'; end if;`;
  });
  return [
    "set local statement_timeout='20min';",
    `do $idrmm_stage$ begin ${counts.join('\n')} end $idrmm_stage$;`,
    ...triggers.map(t => `alter table ${qualified(t)} disable trigger ${quoteId(t.tgname)};`),
    ...constraints.map(fk => `alter table ${qualified(fk)} alter constraint ${quoteId(fk.conname)} deferrable initially deferred;`),
    'set constraints all deferred;',
    ...(registrationHooks.length ? [recoveryRegistration] : []),
    `truncate table ${tables.map(qualified).join(',')};`,
    ...ordered.map(insert),
    ...registrationHooks.slice(0,1).map(hook => hook.definition + ';'),
    'set constraints all immediate;',
    // The managed auth.users trigger creates default profiles. Remove those
    // generated public rows before loading the exact saved account records.
    ...(publicTables.length ? [`truncate table ${publicTables.map(qualified).join(',')};`] : []),
    'set constraints all deferred;',
    ...publicTables.map(insert),
    'set constraints all immediate;',
    ...constraints.map(fk => `alter table ${qualified(fk)} alter constraint ${quoteId(fk.conname)} ${fk.condeferrable ? 'deferrable' : 'not deferrable'} initially ${fk.condeferred ? 'deferred' : 'immediate'};`),
    ...triggers.map(t => `alter table ${qualified(t)} enable ${t.tgenabled === 'A' ? 'always ' : t.tgenabled === 'R' ? 'replica ' : ''}trigger ${quoteId(t.tgname)};`),
  ].join('\n') + '\n';
}

export async function restoreVerificationSql(client, manifest) {
  const checks = [];
  for (const table of manifest.database.tables) {
    const expected = manifest.counts[`${table.schema}.${table.name}`];
    if (!/^\d+$/.test(expected)) throw new Error('Invalid table count.');
    checks.push(`if (select count(*) from ${qualified(table)})<>${expected} then raise exception 'Restored row counts do not match the backup'; end if;`);
  }
  const foreignKeys = (await client.query(`select ns.nspname as schema,c.relname as name,nt.nspname as parent_schema,p.relname as parent_name,k.confmatchtype,
    array(select a.attname::text from unnest(k.conkey) with ordinality x(id,ord) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=x.id order by ord) as columns,
    array(select a.attname::text from unnest(k.confkey) with ordinality x(id,ord) join pg_attribute a on a.attrelid=k.confrelid and a.attnum=x.id order by ord) as parent_columns
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace ns on ns.oid=c.relnamespace
    join pg_class p on p.oid=k.confrelid join pg_namespace nt on nt.oid=p.relnamespace where k.contype='f' and ns.nspname in ('public','auth')`)).rows;
  for (const fk of foreignKeys.filter(f => isRecoveryTable(f.schema, f.name))) {
    const all = fk.columns.map(c => `child.${quoteId(c)} is not null`).join(' and ');
    const match = fk.columns.map((c, i) => `child.${quoteId(c)}=parent.${quoteId(fk.parent_columns[i])}`).join(' and ');
    const orphan = `(${all}) and not exists(select 1 from ${quoteId(fk.parent_schema)}.${quoteId(fk.parent_name)} parent where ${match})`;
    const mixed = fk.confmatchtype === 'f' ? ` or ((${fk.columns.map(c => `child.${quoteId(c)} is not null`).join(' or ')}) and not (${all}))` : '';
    checks.push(`if exists(select 1 from ${qualified(fk)} child where ${orphan}${mixed}) then raise exception 'Restored foreign-key relationships are invalid'; end if;`);
  }
  const invalidate = manifest.database.tables.filter(t => t.schema === 'auth' && ['sessions', 'refresh_tokens', 'flow_state', 'one_time_tokens', 'mfa_challenges', 'mfa_amr_claims'].includes(t.name));
  return `do $idrmm_verify$ begin\n${checks.join('\n')}\nend $idrmm_verify$;\n${invalidate.map(t => `delete from ${qualified(t)};`).join('\n')}\n`;
}

export async function restoreDatabase(client, config, directory, manifest, token) {
  const current = await describeDatabase(client);
  if (current.fingerprint !== manifest.database.fingerprint) throw new Error('Database structure differs from this backup. Restore a matching backup; schema recovery requires the included developer recovery files.');
  const env = await toolEnvironment(config, directory);
  try {
    await writeFile(path.join(directory, 'restore-prelude.sql'), restorePrelude(current.tables, token), { mode: 0o600 });
    await stageDump(path.join(directory,'database','data.sql'), path.join(directory,'restore-staged-data.sql'), current.tables);
    await writeFile(path.join(directory, 'restore-apply.sql'), await restoreApplySql(client, manifest), { mode: 0o600 });
    await writeFile(path.join(directory, 'restore-verify.sql'), await restoreVerificationSql(client, manifest), { mode: 0o600 });
    await runTool(config.psql, ['-X', '--single-transaction', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate', '--set=SHOW_CONTEXT=never', `--file=${path.join(directory, 'restore-prelude.sql')}`, `--file=${path.join(directory, 'restore-staged-data.sql')}`, `--file=${path.join(directory, 'restore-apply.sql')}`, `--file=${path.join(directory, 'restore-verify.sql')}`, `--file=${path.join(directory, 'database', 'sequences.sql')}`], env);
  } finally { await rm(path.join(directory, '.pgpass'), { force: true }); }
}

export async function nativeServerVersion(client) {
  return Number((await client.query('show server_version_num')).rows[0].server_version_num) / 10000 | 0;
}
