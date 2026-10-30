import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import pg from 'pg';
import nextEnv from '@next/env';
import { backupConfig, removeWorkDirectory } from '../lib/backups/package.mjs';
import { connectDatabase, runTool, describeDatabase, countTables, exportDatabase, restoreDatabase } from '../lib/backups/database.mjs';

// Opt-in native drill. It creates an isolated local cluster with password
// authentication. No hosted Supabase connection or application data is used.
test('native pg_dump/psql round trip works without superuser recovery privileges', { skip: process.env.RUN_BACKUP_NATIVE_TESTS !== '1', timeout: 120000 }, async () => {
  nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
  const bin=path.dirname(backupConfig().psql);
  const root=await mkdtemp(path.join(tmpdir(),'idrmm-native-backup-'));
  const data=path.join(root,'cluster'), password=randomBytes(24).toString('hex');
  const operatorPassword=randomBytes(24).toString('hex'), token=randomBytes(32).toString('hex');
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  let started=false, admin, client, snapshot;
  const config={ db:new URL(`postgresql://backup_operator:${operatorPassword}@127.0.0.1:${port}/postgres`), local:true, psql:path.join(bin,'psql.exe'), pgDump:path.join(bin,'pg_dump.exe'), caFile:'' };
  // A background postmaster can inherit a pipe from pg_ctl on Windows. Use
  // ignored handles and wait for the control process's exit, not pipe closure.
  const control=args=>new Promise((resolve,reject)=>{
    const child=spawn(path.join(bin,'pg_ctl.exe'),args,{windowsHide:true,stdio:'ignore',timeout:30000});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Local fixture PostgreSQL control failed.')));
  });
  try {
    const passwordFile=path.join(root,'password');
    await writeFile(passwordFile,password,{mode:0o600});
    await runTool(path.join(bin,'initdb.exe'),['-D',data,'--username=fixture_admin',`--pwfile=${passwordFile}`,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--no-locale','--encoding=UTF8'],{},30000);
    started=true;
    await control(['-D',data,'-l',path.join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','20','start']);
    admin=new pg.Client({host:'127.0.0.1',port,user:'fixture_admin',password,database:'postgres',ssl:false});
    await admin.connect();
    await admin.query(`create role anon; create role authenticated; create role backup_operator login password '${operatorPassword}';
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table auth.users(id uuid primary key,email text);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade);
      create table auth.schema_migrations(version text primary key);
      create table storage.buckets(id text primary key);
      create table storage.objects(id bigint primary key,bucket_id text references storage.buckets,name text);
      grant usage on schema auth,storage to backup_operator;
      grant create,usage on schema public to backup_operator;
      grant all on auth.users,auth.sessions,storage.buckets,storage.objects to backup_operator;`);
    client=await connectDatabase(config);
    await client.query(`create table profiles(id uuid primary key references auth.users,first_name text default 'Generated',last_name text,role text default 'foreman',status text default 'active',invitation_pending boolean default false);
      create table projects(id bigint generated always as identity primary key,name text,created_by uuid references profiles,archived_at timestamptz,gantt_undo_cursor_id bigint);
      create table gantt_snapshots(id bigint generated always as identity primary key,project_id bigint references projects);
      alter table projects add constraint projects_cursor_fk foreign key(gantt_undo_cursor_id) references gantt_snapshots;
      create table tasks(id bigint primary key,project_id bigint references projects,predecessor_task_id bigint references tasks);
      create table logs(id bigint primary key,project_id bigint references projects,amount numeric);
      create table app_user_sessions(session_id uuid primary key references auth.sessions(id) on delete cascade,user_id uuid references auth.users,started_at timestamptz,last_activity_at timestamptz,revoked_at timestamptz);
      create function handle_new_user() returns trigger language plpgsql security definer as $$begin
        if current_setting('fixture.invitation',true) is distinct from 'accepted' then raise exception 'An administrator invitation is required.'; end if;
        insert into public.profiles(id) values(new.id);return new;end$$;`);
    await admin.query('create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()');
    const actor='00000000-0000-4000-8000-000000000001';
    await client.query(`set fixture.invitation='accepted';insert into auth.users values('${actor}','super@example.test');
      update profiles set first_name='Saved',last_name='Administrator',role='super_admin' where id='${actor}';
      insert into auth.sessions values('${actor}','${actor}');
      insert into app_user_sessions values('${actor}','${actor}',now(),now(),null);
      insert into projects(name,created_by,archived_at) values('Fixture project','${actor}',now());
      insert into gantt_snapshots(project_id) values(1);update projects set gantt_undo_cursor_id=1;
      insert into tasks values(1,1,null),(2,1,1);insert into logs values(1,1,800);
      create function deny_nonapplication_write() returns trigger language plpgsql as $$begin raise exception 'Application-only writes';end$$;
      create trigger application_guard before insert on projects for each row execute function deny_nonapplication_write();`);
    await client.query(await readFile(new URL('../supabase/migrations/0105_system_backup_restore.sql',import.meta.url),'utf8'));
    assert.equal((await client.query("select has_parameter_privilege(current_user,'session_replication_role','SET') as allowed")).rows[0].allowed,false);
    await assert.rejects(client.query('set session_replication_role=replica'),/permission denied/);
    await client.query("update system_backup_state set maintenance=true,recovery_required=true,recovery_token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[token]);
    await client.query("select set_config('idrmm.recovery_token',$1,false)",[token]);
    const directory=path.join(root,'snapshot');await mkdir(path.join(directory,'database'),{recursive:true});
    snapshot=await connectDatabase(config);await snapshot.query('begin isolation level repeatable read read only');
    const exported=(await snapshot.query('select pg_export_snapshot() as id')).rows[0].id;
    const database=await describeDatabase(snapshot), counts=await countTables(snapshot,database.tables), manifest={database,counts};
    await exportDatabase(snapshot,config,path.join(directory,'database'),database,exported);
    await snapshot.query('commit');await snapshot.end();snapshot=null;
    await client.query('update logs set amount=999 where id=1');
    await restoreDatabase(client,config,directory,manifest,token);
    assert.equal(Number((await client.query('select amount from logs where id=1')).rows[0].amount),800);
    assert.equal((await client.query('select first_name,role from profiles')).rows[0].first_name,'Saved');
    assert.equal((await client.query('select role from profiles')).rows[0].role,'super_admin');
    assert.ok((await client.query('select archived_at from projects')).rows[0].archived_at);
    assert.equal((await client.query('select gantt_undo_cursor_id from projects')).rows[0].gantt_undo_cursor_id,'1');
    assert.equal((await client.query('select predecessor_task_id from tasks where id=2')).rows[0].predecessor_task_id,'1');
    assert.equal((await client.query('select last_value::text from projects_id_seq')).rows[0].last_value,'1');
    assert.equal((await describeDatabase(client)).fingerprint,database.fingerprint);
    assert.equal((await client.query('select * from app_user_sessions')).rows.length,0,'Restored accounts must sign in again; old session activity must not survive recovery.');
    await client.query("set fixture.invitation=''");
    await assert.rejects(client.query("insert into auth.users values('00000000-0000-4000-8000-000000000002','blocked@example.test')"),/administrator invitation is required/);
    assert.equal((await client.query('select maintenance from system_backup_state')).rows[0].maintenance,true);
    // Guards and constraints must be restored, and failed data validation must
    // roll back actual SQL changes, not merely return a client-side warning.
    await assert.rejects(client.query("insert into projects(name) values('Denied')"),/Application-only writes/);
    await client.query('update logs set amount=999 where id=1');
    const invalid=path.join(root,'invalid');await mkdir(path.join(invalid,'database'),{recursive:true});
    const dump=await readFile(path.join(directory,'database','data.sql'),'utf8');
    const corrupt=dump.replace(/(COPY "public"\."logs" \([^\r\n]*\) FROM stdin;\r?\n)1\t1\t800(\r?\n)/,(_match,header,end)=>`${header}1\t999\t800${end}`);
    assert.notEqual(corrupt,dump,'Fixture must corrupt the saved relationship before checking SQL rollback.');
    await writeFile(path.join(invalid,'database','data.sql'),corrupt);
    await writeFile(path.join(invalid,'database','sequences.sql'),await readFile(path.join(directory,'database','sequences.sql')));
    await assert.rejects(restoreDatabase(client,config,invalid,manifest,token),/database tool failed/);
    assert.equal(Number((await client.query('select amount from logs where id=1')).rows[0].amount),999);
    assert.equal((await describeDatabase(client)).fingerprint,database.fingerprint);
    const invalidLease=path.join(root,'invalid-lease');await mkdir(path.join(invalidLease,'database'),{recursive:true});
    await copyFile(path.join(directory,'database','data.sql'),path.join(invalidLease,'database','data.sql'));
    await copyFile(path.join(directory,'database','sequences.sql'),path.join(invalidLease,'database','sequences.sql'));
    await assert.rejects(restoreDatabase(client,config,invalidLease,manifest,'0'.repeat(64)),/SQLSTATE 42501/);
    assert.equal(Number((await client.query('select amount from logs where id=1')).rows[0].amount),999);
    assert.equal((await describeDatabase(client)).fingerprint,database.fingerprint);
    console.log('Local native drill verified: managed Auth trigger, saved roles, cyclic FKs, identity sequences, archive data, transactional failure, and original schema.');
  } finally {
    if(snapshot) await snapshot.end().catch(()=>{});
    if(client) await client.end().catch(()=>{});
    if(admin) await admin.end().catch(()=>{});
    if(started) await control(['-D',data,'-m','immediate','-w','stop']);
    await removeWorkDirectory(tmpdir(),root);
  }
});
