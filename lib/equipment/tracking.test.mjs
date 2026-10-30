import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch { test('equipment planning integration', { skip: 'Optional @electric-sql/pglite is not installed.' }, () => {}); }
const migration = readFileSync(new URL('../../supabase/migrations/0100_retire_equipment_movement_events.sql', import.meta.url), 'utf8');
if (PGlite) {
async function fixture(apply = true) {
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
create function get_my_role() returns text language sql as $$select coalesce(current_setting('test.role',true),'admin')$$;
create function is_project_foreman(bigint) returns boolean language sql as $$select $1=1 and current_setting('test.role',true) in ('foreman','project_manager')$$;
create table projects(id bigint primary key); insert into projects values(1),(2);
create table profiles(id uuid primary key,first_name text,last_name text);
insert into profiles values(auth.uid(),'Test','Recorder');
create table estimate_categories(id bigint primary key,project_id bigint,category_name text);
insert into estimate_categories values(1,1,'Standalone'),(2,1,'Parent'),(3,2,'Other project');
create table estimate_tasks(id bigint primary key,project_id bigint,category_id bigint,task_name text);
insert into estimate_tasks values(10,1,2,'Excavation'),(11,1,2,'Backfill'),(20,2,3,'Foreign');
create table equipment(id bigint primary key,name text,asset_tag text,status text,current_project_id bigint,last_assigned_at timestamptz,last_returned_at timestamptz);
insert into equipment values(1,'Mixer','EQ-001','available',null,null,null),(2,'Drill','EQ-002','maintenance',null,null,null);
create table equipment_assignments(id bigint generated always as identity primary key,equipment_id bigint references equipment(id),project_id bigint references projects(id),assigned_by uuid,assigned_at timestamptz,returned_at timestamptz,notes text);
`);
  for (const filename of ['0074_equipment_task_assignments.sql','0087_equipment_progress_movements.sql','0088_save_equipment_task_plans.sql','0089_project_equipment_task_picker.sql']) {
    await db.exec(readFileSync(new URL('../../supabase/migrations/' + filename, import.meta.url), 'utf8'));
  }
  if (apply) await db.exec(migration);
  return db;
}
const snapshot = async db => (await db.query('select equipment_tracking_data(1) as data')).rows[0].data;
const save = (db, selected, previous, key='task-10', project=1) => db.query('select save_equipment_task_plans($1,$2,$3,$4)', [project,key,selected,previous]);
async function checkout(db) {
  await db.exec("insert into equipment_assignments(equipment_id,project_id,assigned_by,assigned_at) values(1,1,auth.uid(),now()); update equipment set status='assigned',current_project_id=1 where id=1;");
}

test('planner works without movement events and retains project-only equipment selection', async () => {
  const db=await fixture();
  try {
    assert.equal((await db.query("select to_regclass('public.equipment_movement_events') as t")).rows[0].t,null);
    assert.equal((await db.query("select to_regprocedure('public.record_equipment_operation(bigint,jsonb)') as f")).rows[0].f,null);
    assert.equal('events' in await snapshot(db),false);
    assert.equal((await snapshot(db)).equipment.length,0);
    await assert.rejects(save(db,[1],[]),/Only equipment currently assigned/);
    await checkout(db);
    await save(db,[1],[]);
    await save(db,[1],[]);
    assert.equal((await snapshot(db)).plans.length,1);
    assert.equal((await snapshot(db)).equipment[0].assetTag,'EQ-001');
    assert.equal((await db.query('select count(*)::int n from equipment_assignments')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from equipment_task_assignments')).rows[0].n,0);
    await db.exec(migration);
    assert.equal((await snapshot(db)).plans.length,1,'rerun preserves plans');
  } finally {await db.close();}
});

test('failed, invalid and stale selections do not leave partial plan changes', async () => {
  const db=await fixture();
  try {
    await checkout(db); await save(db,[1],[]);
    await assert.rejects(save(db,[1,2],[1]),/Only equipment currently assigned/);
    await assert.rejects(save(db,[999],[1]),/Only equipment currently assigned/);
    await assert.rejects(save(db,[],[]),/Assignments changed/);
    await assert.rejects(save(db,[1],[1],'category-2'),/valid task/);
    await assert.rejects(save(db,[1],[1],'task-20'),/valid task/);
    await assert.rejects(save(db,[0],[1]),/Invalid equipment/);
    assert.equal((await snapshot(db)).plans.length,1);
    await save(db,[],[1]);
    assert.equal((await snapshot(db)).plans.length,0);
    await save(db,[1,1],[],'category-1');
    assert.equal((await snapshot(db)).plans.length,1);
  } finally {await db.close();}
});

test('role checks and direct-write restrictions remain enforced', async () => {
  const db=await fixture();
  try {
    await checkout(db);
    for(const role of ['foreman','project_manager']) {
      await db.exec(`set test.role='${role}'`);
      await save(db,[1],[]);
      await assert.rejects(save(db,[],[],'task-20',2),/Not authorized/);
      await save(db,[],[1]);
    }
    await db.exec("set test.role='guest'");
    await assert.rejects(save(db,[1],[]),/Not authorized/);
    await assert.rejects(snapshot(db),/Not authorized/);
    await db.exec("set test.role='admin';set role authenticated;");
    await assert.rejects(db.query('delete from equipment_task_plans'),/permission denied/);
    await db.exec('reset role');
  } finally {await db.close();}
});

test('inventory return can still close existing task placements and remove an unavailable plan', async () => {
  const db=await fixture();
  try {
    await checkout(db); await save(db,[1],[]);
    await db.exec("insert into equipment_task_assignments(equipment_assignment_id,project_id,task_id,task_name,assigned_by,assigned_at)values(1,1,10,'Excavation',auth.uid(),now());");
    await db.query('select close_equipment_task_assignment(1,1,now())');
    await db.exec("update equipment_assignments set returned_at=now() where id=1;update equipment set status='available',current_project_id=null where id=1;");
    assert.equal((await db.query('select count(*)::int n from equipment_task_assignments where released_at is null')).rows[0].n,0);
    assert.equal((await snapshot(db)).equipment.length,0);
    await save(db,[],[1]);
    assert.equal((await snapshot(db)).plans.length,0);
    assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n,1);
  } finally {await db.close();}
});

test('populated movement events prevent removal without losing their records', async () => {
  const db=await fixture(false);
  try {
    await db.exec("insert into equipment_movement_events(id,project_id,item_key,equipment_id,action,entry_date,from_location,to_location,recorded_by)values(gen_random_uuid(),1,'task-10',1,'used',current_date,'Inventory','Inventory',auth.uid());");
    await assert.rejects(db.exec(migration),/contains 1 records/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from equipment_movement_events')).rows[0].n,1);
    assert.equal('events' in await snapshot(db),true);
  } finally {await db.close();}
});

test('unexpected dependencies abort and restore the original RPC definitions', async () => {
  const db=await fixture(false);
  try {
    await db.exec('create view retained_event_view as select * from equipment_movement_events');
    await assert.rejects(db.exec(migration),/cannot drop|depend/);
    await db.exec('rollback');
    assert.equal('events' in await snapshot(db),true);
    assert.notEqual((await db.query("select to_regprocedure('public.record_equipment_operation(bigint,jsonb)') as f")).rows[0].f,null);
  } finally {await db.close();}
});
}
