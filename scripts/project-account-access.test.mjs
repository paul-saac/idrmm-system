import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const migration = await readFile(new URL("../supabase/migrations/0101_project_account_access.sql", import.meta.url), "utf8");
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth,storage to authenticated;
    create table profiles(id uuid primary key,role text,status text default 'active',invitation_pending boolean default false,first_name text,last_name text);
    create table projects(id bigint primary key,project_name text,location text,project_manager_id uuid,foreman_id uuid);
    create table account_events(id bigint generated always as identity,actor_id uuid,actor_name text,target_id uuid,target_name text,action text,details text);
    create table estimate_tasks(id bigint primary key,project_id bigint references projects on delete cascade,task_name text);
    create table estimate_categories(id bigint primary key,project_id bigint references projects on delete cascade);
    create table task_progress_entries(id bigint primary key,task_id bigint references estimate_tasks on delete cascade);
    create table category_progress_entries(id bigint primary key,category_id bigint references estimate_categories on delete cascade);
    create table task_progress_attendance(id bigint primary key,progress_entry_id bigint references task_progress_entries on delete cascade,hours numeric);
    create table project_sheets(id bigint primary key,project_id bigint);
    create table material_requests(id bigint primary key,project_id bigint);
    create table equipment_requests(id bigint primary key,project_id bigint);
    create table storage.objects(id bigint primary key,bucket_id text,name text);
    alter table storage.objects enable row level security;
    create policy storage_base on storage.objects for all to authenticated using(true) with check(true);
    grant select,insert,update,delete on storage.objects to authenticated;
    insert into profiles values
      ('${id(1)}','admin','active',false,'Admin','One'),
      ('${id(2)}','project_manager','active',false,'Manager','One'),
      ('${id(3)}','foreman','active',false,'Foreman','One'),
      ('${id(4)}','foreman','active',false,'Shared','User'),
      ('${id(5)}','project_manager','active',false,'Other','Manager'),
      ('${id(6)}','foreman','active',true,'Pending','User');
    insert into projects values(1,'Project A','Here','${id(2)}','${id(3)}'),(2,'Project B','There','${id(5)}','${id(3)}');
    insert into estimate_tasks values(10,1,'Original'),(20,2,'Other');
    insert into task_progress_entries values(100,10),(200,20);
    insert into task_progress_attendance values(1000,100,8),(2000,200,8);
    create function get_my_role() returns text language sql stable security definer as $$select role from profiles where id=auth.uid()$$;
    create function is_project_foreman(bigint) returns boolean language sql stable security definer as $$select exists(select 1 from projects where id=$1 and (foreman_id=auth.uid() or project_manager_id=auth.uid()))$$;
    create function can_read_project_sheets(bigint) returns boolean language sql stable as $$select is_project_foreman($1)$$;
    grant select on profiles to authenticated;
    grant usage,select on all sequences in schema public to authenticated;
    do $$declare t text; begin foreach t in array array['projects','estimate_tasks','estimate_categories','task_progress_entries','category_progress_entries','task_progress_attendance','project_sheets','material_requests','equipment_requests'] loop
      execute format('alter table %I enable row level security',t);
      execute format('grant select,insert,update,delete on %I to authenticated',t);
      execute format('create policy base on %I for all to authenticated using(true) with check(true)',t);
    end loop; end$$;
    -- Representative definer RPC, whose writes must still be guarded.
    create function rpc_change_task(bigint,text) returns void language sql security definer as $$update estimate_tasks set task_name=$2 where id=$1$$;
  `);
  await db.exec(migration);
  return db;
}
async function as(db, user) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id(user)}',false); set role authenticated;`);
}
async function grant(db, actor, target, project, previous, level) {
  await as(db, actor);
  await db.query("select save_project_account_access($1::uuid,$2::jsonb)", [id(target), JSON.stringify([{ id: project, previous, level }])]);
}

test("project access retains assignments and grants view/edit with audited atomic saves", async () => {
  const db = await setup();
  try {
    await as(db, 3);
    assert.equal((await db.query("select project_access_level(1) as level")).rows[0].level, "edit");
    await grant(db, 1, 4, 1, "none", "view");
    await as(db, 4);
    assert.equal((await db.query("select project_access_level(1) as level, is_project_foreman(1) as readable, can_read_project_sheets(1) as sheets")).rows[0].level, "view");
    assert.equal((await db.query("select is_project_foreman(2) as ok")).rows[0].ok, false);
    assert.deepEqual((await db.query("select id from estimate_tasks order by id")).rows.map(row => row.id), [10]);
    await assert.rejects(db.exec("insert into estimate_tasks values(11,1,'Denied')"), /view only|row-level security/);
    await assert.rejects(db.exec("select rpc_change_task(10,'Denied')"), /view only/);
    assert.equal((await db.query("update estimate_tasks set task_name='Denied' where id=10 returning id")).rows.length, 0);
    assert.equal((await db.query("delete from task_progress_attendance where id=1000 returning id")).rows.length, 0);
    await assert.rejects(db.exec("truncate estimate_tasks cascade"), /permission denied/);
    await assert.rejects(db.exec("insert into storage.objects values(1,'incident-evidence','1/test.jpg')"), /row-level security/);
    await grant(db, 2, 4, 1, "view", "edit");
    await as(db, 4);
    await db.exec("select rpc_change_task(10,'Allowed'); insert into task_progress_attendance values(1001,100,4); insert into storage.objects values(1,'incident-evidence','1/test.jpg')");
    assert.equal((await db.query("select task_name from estimate_tasks where id=10")).rows[0].task_name, "Allowed");
    await grant(db, 2, 4, 1, "edit", "none");
    await as(db, 4);
    assert.equal((await db.query("select project_access_level(1) as level")).rows[0].level, "none");
    assert.equal((await db.query("select id from estimate_tasks")).rows.length, 0);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as n from account_events")).rows[0].n, 3);
  } finally { await db.close(); }
});

test("sharing cannot escalate management, alter foreign projects, race a stale editor or activate an invite", async () => {
  const db = await setup();
  try {
    await assert.rejects(grant(db, 2, 4, 2, "none", "edit"), /projects you manage/);
    await assert.rejects(grant(db, 3, 4, 1, "none", "edit"), /management denied/);
    await assert.rejects(grant(db, 2, 2, 1, "edit", "none"), /cannot change/);
    await assert.rejects(grant(db, 1, 6, 1, "none", "view"), /invitation/);
    await as(db, 2);
    await assert.rejects(db.query("select save_project_account_access($1::uuid,$2::jsonb)", [id(4), JSON.stringify([
      { id: 1, previous: "none", level: "edit" }, { id: 2, previous: "none", level: "edit" },
    ])]), /projects you manage/);
    assert.equal((await db.query("select count(*)::int as n from project_account_access")).rows[0].n, 0);
    await grant(db, 1, 4, 1, "none", "view");
    await assert.rejects(grant(db, 2, 4, 1, "none", "edit"), /changed since/);
    await as(db, 4);
    await assert.rejects(db.exec(`insert into project_account_access values(2,'${id(4)}','edit','${id(4)}',now())`), /permission denied/);
    await as(db, 2);
    const settings = (await db.query("select project_account_access_editor($1::uuid) as settings",[id(4)])).rows[0].settings;
    assert.deepEqual(settings.projects.map(p => p.id), [1]);
    await as(db, 1);
    await db.exec(`insert into projects values(3,'New project','Here','${id(2)}','${id(3)}') returning id`);
    await db.exec("delete from projects where id=1");
    await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
    assert.equal((await db.query("select count(*)::int as n from task_progress_attendance where id=1000")).rows[0].n, 0);
  } finally { await db.close(); }
});
