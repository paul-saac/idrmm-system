import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); } catch { /* Optional local SQL test runtime. */ }
const migration = readFileSync(new URL('../../supabase/migrations/0107_estimate_row_order.sql', import.meta.url), 'utf8');

test('row-order migration and RPC preserve records, enforce permissions and save only sibling order atomically', { skip: !PGlite }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table public.projects(id bigint primary key, access text default 'edit');
      create table public.estimate_categories(id bigint primary key, project_id bigint, category_name text, planned_start_date date, cost numeric);
      create table public.estimate_tasks(id bigint primary key, project_id bigint, category_id bigint, task_name text, progress numeric, predecessor_task_id bigint);
      create function public.app_session_is_active() returns boolean language sql as $$ select coalesce(current_setting('test.session', true), 'active') = 'active' $$;
      create function public.project_access_level(project bigint) returns text language sql as $$ select access from public.projects where id=project $$;
      create function public.system_backup_maintenance() returns boolean language sql as $$ select coalesce(current_setting('test.maintenance',true),'false')='true' $$;
      insert into public.projects values (1,'edit'),(2,'edit'),(3,'view');
      insert into public.estimate_categories values (1,1,'Mobilization','2026-10-30',500),(2,1,'Concrete','2026-11-01',3000),(3,1,'Finish','2026-12-01',1000),(4,2,'Other project','2026-12-02',200),(5,3,'Archived','2026-12-03',200);
      insert into public.estimate_tasks values (11,1,2,'Footings',50,null),(12,1,2,'Columns',0,11),(13,1,2,'Inspection',0,12),(21,1,3,'Paint',0,null),(41,2,4,'Other',0,null);
      grant usage on schema public to authenticated;
      grant select,update on public.projects,public.estimate_categories,public.estimate_tasks to authenticated;
    `);
    const beforeCategories = (await db.query('select * from estimate_categories order by id')).rows;
    const beforeTasks = (await db.query('select * from estimate_tasks order by id')).rows;
    await db.exec(migration);
    await db.exec(migration); // Idempotent setup must not touch business records.
    const rpc = async (project, kind, id, target, after = false) =>
      (await db.query('select public.move_estimate_row($1,$2,$3,$4,$5) as result', [project, kind, id, target, after])).rows[0].result;
    await db.exec('set role authenticated');
    assert.deepEqual((await rpc(1, 'category', 3, 1)).ids, [3, 1, 2]);
    assert.deepEqual((await db.query('select id::int as id from estimate_categories where project_id=1 order by sort_order nulls last,id')).rows.map(row => row.id), [3, 1, 2]);
    assert.deepEqual((await rpc(1, 'task', 13, 11)).ids, [13, 11, 12]);
    assert.equal((await rpc(1, 'task', 11, 12, true)).category_id, 2);
    assert.deepEqual((await rpc(1, 'task', 11, 12, true)).ids, [13, 12, 11]);
    for (const input of [[1,'task',11,21], [1,'task',11,41], [1,'category',1,4], [1,'task',999,11], [1,'category',1,1]]) {
      await assert.rejects(rpc(...input), error => error.code === '22023');
    }
    await assert.rejects(rpc(3,'category',5,1), error => error.code === '42501');
    await assert.rejects(rpc(999,'category',1,2), error => error.code === '42501');
    await db.exec("set test.session='expired'");
    await assert.rejects(rpc(1,'category',1,2), error => error.code === '42501');
    await db.exec("set test.session='active'; set test.maintenance='true'");
    await assert.rejects(rpc(1,'category',1,2), error => error.code === '55000');
    await db.exec("set test.maintenance='false'; reset role");
    const afterCategories = (await db.query('select id,project_id,category_name,planned_start_date,cost from estimate_categories order by id')).rows;
    const afterTasks = (await db.query('select id,project_id,category_id,task_name,progress,predecessor_task_id from estimate_tasks order by id')).rows;
    assert.deepEqual(afterCategories, beforeCategories);
    assert.deepEqual(afterTasks, beforeTasks);
    await db.exec("insert into estimate_categories(id,project_id,category_name) values(6,1,'New task')");
    assert.deepEqual((await db.query('select id::int as id from estimate_categories where project_id=1 order by sort_order nulls last,id')).rows.map(row => row.id), [3,1,2,6]);
    await db.exec('set role anon');
    await assert.rejects(rpc(1,'category',1,2), error => error.code === '42501');
    await db.exec('reset role');
    // Simulate a write policy that permits only part of the sibling group:
    // the row-count check must roll back every change, not leave a partial order.
    await db.exec(`alter table estimate_tasks enable row level security;
      create policy read_tasks on estimate_tasks for select to authenticated using(true);
      create policy write_tasks on estimate_tasks for update to authenticated using(id<>12) with check(id<>12);
      set role authenticated;`);
    const prior = (await db.query('select id,sort_order from estimate_tasks order by id')).rows;
    await assert.rejects(rpc(1,'task',11,13), error => error.code === '42501');
    assert.deepEqual((await db.query('select id,sort_order from estimate_tasks order by id')).rows, prior);
  } finally { await db.close(); }
});
