import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const accessMigration = await readFile(new URL("../supabase/migrations/0101_project_account_access.sql", import.meta.url), "utf8");
const archiveMigration = await readFile(new URL("../supabase/migrations/0104_project_archiving.sql", import.meta.url), "utf8");
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth,storage to authenticated;
    create table profiles(id uuid primary key,role text,status text default 'active',invitation_pending boolean default false,first_name text,last_name text);
    create table projects(id bigint primary key,project_name text,location text,project_manager_id uuid,foreman_id uuid,status text default 'completed',allocated_budget numeric default 10000);
    create table account_events(id bigint generated always as identity,actor_id uuid,actor_name text,target_id uuid,target_name text,action text,details text);
    create table estimate_categories(id bigint primary key,project_id bigint references projects on delete cascade);
    create table estimate_tasks(id bigint primary key,project_id bigint references projects on delete cascade,category_id bigint references estimate_categories,task_name text);
    create table task_progress_entries(id bigint primary key,task_id bigint references estimate_tasks on delete cascade,quantity_completed numeric);
    create table category_progress_entries(id bigint primary key,category_id bigint references estimate_categories on delete cascade);
    create table task_progress_attendance(id bigint primary key,progress_entry_id bigint references task_progress_entries on delete cascade,hours numeric);
    create table project_sheets(id bigint primary key,project_id bigint references projects on delete cascade,file_path text);
    create table project_safety_incidents(id bigint primary key,project_id bigint references projects on delete cascade,description text);
    create table material_requests(id bigint primary key,project_id bigint,status text);
    create table equipment_requests(id bigint primary key,project_id bigint,status text);
    create table equipment(id bigint primary key,current_project_id bigint);
    create table equipment_assignments(id bigint primary key,project_id bigint,equipment_id bigint,returned_at timestamptz);
    create table equipment_task_assignments(id bigint primary key,project_id bigint,released_at timestamptz);
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
      ('${id(6)}','admin','active',true,'Pending','Admin'),
      ('${id(7)}','super_admin','active',false,'Super','Admin'),
      ('${id(8)}','admin','inactive',false,'Inactive','Admin');
    insert into projects(id,project_name,project_manager_id,foreman_id) values
      (1,'Completed project','${id(2)}','${id(3)}'),(2,'Foreign project','${id(5)}','${id(3)}');
    insert into estimate_categories values(9,1);
    insert into estimate_tasks values(10,1,9,'Original');
    insert into task_progress_entries values(100,10,50);
    insert into task_progress_attendance values(1000,100,8);
    insert into project_sheets values(1,1,'1/drawing.pdf');
    insert into project_safety_incidents values(1,1,'Original incident');
    insert into storage.objects values(1,'project-sheets','1/drawing.pdf'),(2,'incident-evidence','1/evidence.jpg'),(3,'purchase-receipts','1/receipt.pdf'),(4,'punch-list-evidence','1/punch.jpg');
    create function get_my_role() returns text language sql stable security definer as $$select case when role='super_admin' then 'admin' else role end from profiles where id=auth.uid()$$;
    create function is_project_foreman(bigint) returns boolean language sql stable security definer as $$select exists(select 1 from projects where id=$1 and (foreman_id=auth.uid() or project_manager_id=auth.uid()))$$;
    create function can_read_project_sheets(bigint) returns boolean language sql stable as $$select is_project_foreman($1)$$;
    grant select on profiles to authenticated;
    grant usage,select on all sequences in schema public to authenticated;
    do $$declare t text; begin foreach t in array array['projects','estimate_tasks','estimate_categories','task_progress_entries','category_progress_entries','task_progress_attendance','project_sheets','project_safety_incidents','material_requests','equipment_requests','equipment','equipment_assignments','equipment_task_assignments'] loop
      execute format('alter table %I enable row level security',t);
      execute format('grant select,insert,update,delete on %I to authenticated',t);
      execute format('create policy base on %I for all to authenticated using(true) with check(true)',t);
    end loop; end$$;
    create function rpc_change_task(bigint,text) returns void language sql security definer as $$update estimate_tasks set task_name=$2 where id=$1$$;
  `);
  await db.exec(accessMigration);
  await db.exec(archiveMigration);
  return db;
}
async function as(db, user) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user ? id(user) : ""}',false); ${user ? "set role authenticated;" : ""}`);
}
async function archive(db, actor = 1, value = true, reason = "Completed and handed over") {
  await as(db, actor);
  return db.query("select set_project_archived(1,$1,$2)", [value, reason]);
}

test("archive retains project status, saved work, related records and attachment metadata; unarchive restores access", async () => {
  const db = await setup();
  try {
    await as(db, 1);
    await db.query("select save_project_account_access($1::uuid,$2::jsonb)", [id(4), JSON.stringify([{ id: 1, previous: "none", level: "edit" }])]);
    await archive(db);
    const project = (await db.query("select * from projects where id=1")).rows[0];
    assert.equal(project.status, "completed");
    assert.equal(Number(project.allocated_budget), 10000);
    assert.equal(project.archived_by, id(1));
    assert.equal(project.archive_reason, "Completed and handed over");
    assert.ok(project.archived_at);
    for (const actor of [1, 2, 3, 4, 7]) {
      await as(db, actor);
      assert.equal((await db.query("select project_access_level(1) as level")).rows[0].level, "view");
      assert.equal((await db.query("select quantity_completed from task_progress_entries where id=100")).rows[0].quantity_completed, "50");
      assert.equal((await db.query("select count(*)::int n from project_sheets")).rows[0].n, 1);
      assert.equal((await db.query("select count(*)::int n from project_safety_incidents")).rows[0].n, 1);
      assert.equal((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 4);
    }
    await as(db, 5);
    assert.equal((await db.query("select project_access_level(1) as level")).rows[0].level, "none");
    assert.equal((await db.query("select count(*)::int n from estimate_tasks")).rows[0].n, 0);
    await archive(db, 7, false);
    for (const actor of [1, 2, 3, 4, 7]) {
      await as(db, actor);
      assert.equal((await db.query("select project_access_level(1) as level")).rows[0].level, "edit");
    }
    await as(db, 1);
    const restored = (await db.query("select status,archived_at,archived_by,archive_reason from projects where id=1")).rows[0];
    assert.deepEqual(restored, { status: "completed", archived_at: null, archived_by: null, archive_reason: null });
    await db.query("select save_project_account_access($1::uuid,$2::jsonb)", [id(3), JSON.stringify([{ id: 1, previous: "edit", level: "none" }])]);
    await db.query("select save_project_account_access($1::uuid,$2::jsonb)", [id(4), JSON.stringify([{ id: 1, previous: "edit", level: "view" }])]);
    await archive(db);
    for (const [actor, level] of [[3, "none"], [4, "view"]]) {
      await as(db, actor);
      assert.equal((await db.query("select project_access_level(1) as level")).rows[0].level, level);
    }
    await archive(db, 7, false);
    for (const [actor, level] of [[3, "none"], [4, "view"]]) {
      await as(db, actor);
      assert.equal((await db.query("select project_access_level(1) as level")).rows[0].level, level);
    }
  } finally { await db.close(); }
});

test("all roles, direct writes, definer RPCs and service-style writes respect archived read-only state", async () => {
  const db = await setup();
  try {
    await archive(db);
    for (const actor of [1, 2, 3, 7]) {
      await as(db, actor);
      assert.equal((await db.query("update projects set project_name='Denied' where id=1 returning id")).rows.length, 0);
      assert.equal((await db.query("delete from estimate_tasks where id=10 returning id")).rows.length, 0);
      await assert.rejects(db.exec("insert into task_progress_attendance values(1001,100,4)"), /row-level security|archived|view only/);
      await assert.rejects(db.exec("select rpc_change_task(10,'Denied')"), /archived|view only/);
      assert.equal((await db.query("delete from storage.objects where bucket_id in ('project-sheets','incident-evidence','purchase-receipts','punch-list-evidence') returning id")).rows.length, 0);
      for (const bucket of ['incident-evidence','project-sheets','purchase-receipts','punch-list-evidence']) {
        await assert.rejects(db.exec(`insert into storage.objects values(5,'${bucket}','1/new.jpg')`), /row-level security/);
      }
    }
    await as(db, null);
    await assert.rejects(db.exec("update projects set allocated_budget=1 where id=1"), /archived/);
    await assert.rejects(db.exec("delete from project_sheets where id=1"), /archived/);
    await assert.rejects(db.exec("update task_progress_attendance set hours=1 where id=1000"), /archived/);
    await assert.rejects(db.exec("delete from projects where id=1"), /archived/);
    await assert.rejects(db.exec("insert into equipment values(1,1)"), /archived/);
    assert.equal((await db.query("select task_name from estimate_tasks where id=10")).rows[0].task_name, "Original");
  } finally { await db.close(); }
});

test("only accepted active administrators may change archive state; crafted metadata changes cannot edit records", async () => {
  const db = await setup();
  try {
    for (const actor of [2, 3, 4, 5, 6, 8]) await assert.rejects(archive(db, actor), /Only administrators/);
    await as(db, null);
    await assert.rejects(db.exec("update projects set archived_at=now(),archived_by='" + id(1) + "' where id=1"), /Only administrators/);
    await as(db, 1);
    await assert.rejects(db.exec("delete from projects where id=2"), /permission denied/);
    await assert.rejects(db.exec("update projects set archived_at=now(),archived_by='" + id(1) + "',allocated_budget=1 where id=1"), /cannot modify/);
    await assert.rejects(db.exec("insert into projects(id,project_name,archived_at,archived_by) values(3,'Fake',now(),'" + id(1) + "')"), /Create the project/);
    await archive(db);
    for (const actor of [2, 3, 4, 5]) await assert.rejects(archive(db, actor, false), /Only administrators/);
    await assert.rejects(archive(db), /state changed/);
    await as(db, 1);
    assert.equal((await db.query("update projects set archived_at=null,allocated_budget=1 where id=1 returning id")).rows.length, 0);
    // Bypass RLS like a trusted RPC would, retaining the actor JWT: the
    // trigger must independently reject simultaneous data changes.
    await db.exec("reset role");
    await assert.rejects(db.exec("update projects set archived_at=null,allocated_budget=1 where id=1"), /cannot modify/);
  } finally { await db.close(); }
});

test("archiving requires completed work and resolved equipment and requests without modifying them", async () => {
  const db = await setup();
  try {
    await as(db, null);
    await db.exec("update projects set status='ongoing' where id=1");
    await assert.rejects(archive(db), /Only completed/);
    await as(db, null);
    await db.exec("update projects set status='completed' where id=1; insert into equipment values(1,1)");
    await assert.rejects(archive(db), /Return all assigned equipment/);
    await as(db, null);
    assert.equal((await db.query("select current_project_id from equipment where id=1")).rows[0].current_project_id, 1);
    await db.exec("update equipment set current_project_id=null; insert into equipment_assignments values(1,1,1,null)");
    await assert.rejects(archive(db), /Return all assigned equipment/);
    await as(db, null);
    await db.exec("update equipment_assignments set returned_at=now(); insert into equipment_task_assignments values(1,1,null)");
    await assert.rejects(archive(db), /Return all assigned equipment/);
    await as(db, null);
    await db.exec("update equipment_task_assignments set released_at=now(); insert into material_requests values(1,1,'submitted')");
    await assert.rejects(archive(db), /Fulfill or cancel/);
    await as(db, null);
    await db.exec("update material_requests set status='fulfilled'; insert into equipment_requests values(1,1,'partially_fulfilled')");
    await assert.rejects(archive(db), /Fulfill or cancel/);
    await as(db, null);
    await db.exec("update equipment_requests set status='canceled'");
    await assert.rejects(archive(db, 1, true, "x".repeat(1001)), /1,000/);
    await archive(db);
    assert.ok((await db.query("select archived_at from projects where id=1")).rows[0].archived_at);
  } finally { await db.close(); }
});
