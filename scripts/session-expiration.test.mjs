import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const sql = readFileSync(new URL('../supabase/migrations/0106_session_expiration.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function setup(existingHook = false) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role authenticator; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz default now(),not_after timestamptz);
    create table public.records(id bigint primary key,owner_id uuid references auth.users,amount numeric);
    alter table public.records enable row level security;
    create policy own_records on public.records for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
    create table storage.buckets(id text primary key);
    create table storage.objects(id bigint primary key,bucket_id text);
    alter table storage.buckets enable row level security;
    alter table storage.objects enable row level security;
    create policy storage_read on storage.objects for all to authenticated using(true) with check(true);
    create policy bucket_read on storage.buckets for select to authenticated using(true);
    create function public.sensitive_rpc() returns numeric language sql security definer as $$select sum(amount) from public.records$$;
    insert into auth.users values('${id(1)}'),('${id(2)}');
    insert into auth.sessions(id,user_id) values('${id(11)}','${id(1)}'),('${id(12)}','${id(2)}');
    insert into public.records values(1,'${id(1)}',100),(2,'${id(2)}',200);
    insert into storage.buckets values('evidence');insert into storage.objects values(1,'evidence');
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select,insert,update,delete on all tables in schema public,storage to authenticated,service_role;
  `);
  if (existingHook) await db.exec("alter role authenticator set pgrst.db_pre_request='public.other_hook'");
  try { await db.exec(sql); } catch (error) { await db.close(); throw error; }
  return db;
}
async function actor(db, user=1, session=11, role='authenticated', route='/rpc/app_session_state') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.path',$2,false)", [JSON.stringify({ sub:id(user),session_id:id(session),role }),route]);
  await db.exec(`set role ${role}`);
}
async function state(db, activity=false, end=false) {
  return (await db.query('select public.app_session_state($1,$2) as state',[activity,end])).rows[0].state;
}
async function expire(db, idle='31 minutes', started='1 hour') {
  await db.exec('reset role');
  await db.query(`update public.app_user_sessions set started_at=statement_timestamp()-$1::interval,last_activity_at=statement_timestamp()-$2::interval where session_id=$3`,[started,idle,id(11)]);
}

test('fresh login uses Auth timestamps; status polling does not extend activity or reset the maximum', async()=>{
  const db=await setup();try {
    await actor(db);const initial=await state(db);assert.equal(initial.active,true);
    const again=await state(db);assert.equal(again.idleExpiresAt,initial.idleExpiresAt);
    assert.equal(again.absoluteExpiresAt,initial.absoluteExpiresAt);
    await expire(db,'10 minutes');await actor(db);const renewed=await state(db,true);
    assert.equal(renewed.active,true);assert.ok(Date.parse(renewed.idleExpiresAt)>Date.parse(again.serverNow));
    assert.ok(Math.abs(Date.parse(renewed.absoluteExpiresAt)-Date.parse(renewed.serverNow)-11*60*60*1000)<1000);
  }finally{await db.close();}
});

test('idle expiration and the 12-hour maximum reject activity and re-registration',async()=>{
  const db=await setup();try {
    await actor(db);await state(db);await expire(db);await actor(db);
    for(let i=0;i<3;i++){const expired=await state(db,true);assert.equal(expired.active,false);assert.equal(expired.reason,'idle');}
    await expire(db,'1 minute','12 hours');await actor(db);
    const maximum=await state(db,true);assert.equal(maximum.active,false);assert.equal(maximum.reason,'maximum');
    await db.exec('reset role');await db.query('delete from public.app_user_sessions where session_id=$1',[id(11)]);
    await db.query("update auth.sessions set created_at=statement_timestamp()-interval '13 hours' where id=$1",[id(11)]);
    await actor(db);assert.equal((await state(db,true)).active,false);
  }finally{await db.close();}
});

test('the inactivity cutoff is enforced at 30 minutes and permits activity just before it',async()=>{
  const db=await setup();try {
    await actor(db);await state(db);await expire(db,'29 minutes 59 seconds');await actor(db);
    assert.equal((await state(db)).active,true);
    await expire(db,'30 minutes');await actor(db);
    const expired=await state(db,true);assert.equal(expired.active,false);assert.equal(expired.reason,'idle');
  }finally{await db.close();}
});

test('session cookies/JWT claims cannot choose another user session; revoked sessions cannot restart',async()=>{
  const db=await setup();try {
    await actor(db,1,12);assert.equal((await state(db,true)).active,false);
    await actor(db);await state(db);assert.equal((await state(db,false,true)).active,false);
    assert.equal((await state(db,true)).active,false);
    await assert.rejects(db.exec('select * from public.app_user_sessions'),/permission denied/);
    await assert.rejects(db.exec('update public.app_user_sessions set revoked_at=null'),/permission denied/);
    await actor(db,2,12);assert.equal((await state(db)).active,true);
  }finally{await db.close();}
});

test('RLS blocks expired direct reads, writes and Storage while preserving existing ownership policies',async()=>{
  const db=await setup();try {
    await actor(db);await state(db);
    assert.deepEqual((await db.query('select id from public.records')).rows,[{id:1}]);
    await assert.rejects(db.exec(`insert into public.records values(3,'${id(2)}',500)`),/row-level security/);
    assert.equal((await db.query('select * from storage.objects')).rows.length,1);
    await expire(db);await actor(db);
    assert.equal((await db.query('select * from public.records')).rows.length,0);
    assert.equal((await db.query('select * from storage.objects')).rows.length,0);
    assert.equal((await db.query('select * from storage.buckets')).rows.length,0);
    await assert.rejects(db.exec(`insert into public.records values(4,'${id(1)}',500)`),/row-level security/);
    await assert.rejects(db.exec("insert into storage.objects values(2,'evidence')"),/row-level security/);
    await db.exec('update public.records set amount=0;delete from public.records');
    await db.exec('reset role');assert.equal((await db.query('select sum(amount)::int as amount from public.records')).rows[0].amount,300);
  }finally{await db.close();}
});

test('Data API hook protects definer RPCs and only permits the safe state endpoint after expiry',async()=>{
  const db=await setup();try {
    await actor(db);await state(db);await actor(db,1,11,'authenticated','/rpc/sensitive_rpc');
    await db.exec('select public.enforce_app_session()');
    await expire(db);await actor(db,1,11,'authenticated','/rpc/sensitive_rpc');
    await assert.rejects(db.exec('select public.enforce_app_session();select public.sensitive_rpc()'),/session has expired/);
    await actor(db);await db.exec('select public.enforce_app_session()');assert.equal((await state(db,true)).active,false);
    await actor(db,1,11,'authenticated','/rpc/app_session_state/');
    await assert.rejects(db.exec('select public.enforce_app_session()'),/session has expired/);
    await actor(db,1,11,'service_role','/rpc/sensitive_rpc');await db.exec('select public.enforce_app_session()');
    assert.equal((await db.query('select * from public.records')).rows.length,2);
  }finally{await db.close();}
});

test('Auth revocation and not_after immediately prevent reuse; authenticated RPCs require valid sessions',async()=>{
  const db=await setup();try {
    await actor(db);await state(db);await db.exec('reset role');
    await db.query("update auth.sessions set not_after=statement_timestamp()-interval '1 second' where id=$1",[id(11)]);
    await actor(db);assert.equal((await state(db,true)).active,false);
    await db.exec('reset role');await db.query('delete from auth.sessions where id=$1',[id(11)]);
    assert.equal((await db.query('select * from public.app_user_sessions')).rows.length,0);
    await actor(db);assert.equal((await state(db,true)).active,false);
    await actor(db,1,11,'anon');await assert.rejects(state(db),/permission denied/);
  }finally{await db.close();}
});

test('migration refuses to overwrite an unrelated pre-request hook',async()=>{
  await assert.rejects(setup(true),/existing Data API pre-request hook/);
  const db=await setup();try {
    await db.exec('reset role');
    const setting=(await db.query("select unnest(setconfig) as value from pg_db_role_setting where setrole=(select oid from pg_roles where rolname='authenticator')")).rows;
    assert.ok(setting.some(s=>s.value==='pgrst.db_pre_request=public.enforce_app_session'));
  }finally{await db.close();}
});
