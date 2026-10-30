import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let PGlite; try { ({ PGlite } = require('@electric-sql/pglite')); } catch { /* Optional SQL test runtime. */ }
const migration = readFileSync(new URL('../../supabase/migrations/0108_milestone_project_successors.sql', import.meta.url), 'utf8');

test('milestone successor migration/RPC supports cross-type links atomically with cycle, project and permission checks', { skip: !PGlite }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table projects(id bigint primary key,access text);
      create table estimate_categories(id bigint primary key,project_id bigint not null references projects(id),category_name text not null,is_milestone boolean not null default false,predecessor_category_id bigint references estimate_categories(id) on delete set null,cost numeric default 0);
      create table estimate_tasks(id bigint primary key,project_id bigint not null references projects(id),category_id bigint not null references estimate_categories(id),task_name text not null,is_milestone boolean not null default false,predecessor_task_id bigint references estimate_tasks(id) on delete set null,progress numeric default 0);
      create function app_session_is_active() returns boolean language sql as $$ select coalesce(current_setting('test.session',true),'active')='active' $$;
      create function project_access_level(project bigint) returns text language sql as $$ select access from projects where id=project $$;
      create function system_backup_maintenance() returns boolean language sql as $$ select coalesce(current_setting('test.maintenance',true),'false')='true' $$;
      insert into projects values(1,'edit'),(2,'edit'),(3,'view');
      insert into estimate_categories(id,project_id,category_name,is_milestone,cost) values (1,1,'Start',true,100),(2,1,'Concrete',false,200),(3,1,'Finishing',false,300),(4,1,'Permit',false,400),(8,2,'Other project',false,800),(9,3,'Archived',true,900);
      insert into estimate_tasks(id,project_id,category_id,task_name,is_milestone,progress) values (1,1,2,'Footings',false,50),(2,1,2,'Columns',false,20),(3,1,2,'Inspection',true,0),(4,1,3,'Paint',false,0),(5,1,3,'Finish',false,0),(8,2,8,'Other',false,0);
      update estimate_tasks set predecessor_task_id=1 where id=2;
      update estimate_categories set predecessor_category_id=1 where id=4;
      grant usage on schema public to authenticated;
      grant select,update on projects,estimate_categories,estimate_tasks to authenticated;`);
    const oldCosts = (await db.query('select id,cost from estimate_categories order by id')).rows;
    const oldProgress = (await db.query('select id,progress from estimate_tasks order by id')).rows;
    await db.exec(migration); await db.exec(migration);
    const save = async (kind, id, targetKind, targetId, milestone = null, project = 1, name = null) => db.query(
      'select save_estimate_successor($1,$2,$3,$4,$5,$6,$7)', [project,kind,id,targetKind,targetId,milestone,name]);
    const field = async (table,id,key) => (await db.query(`select ${key} as value from ${table} where id=$1`,[id])).rows[0].value;
    await db.exec('set role authenticated');
    await save('category',1,'task',4,true);
    assert.equal(await field('estimate_tasks',4,'predecessor_category_id'),1);
    assert.equal(await field('estimate_categories',4,'predecessor_category_id'),null);
    await save('category',1,'category',3,true);
    assert.equal(await field('estimate_categories',3,'predecessor_category_id'),1);
    assert.equal(await field('estimate_tasks',4,'predecessor_category_id'),null);
    await save('task',3,'task',4,true);
    assert.equal(await field('estimate_tasks',4,'predecessor_task_id'),3);
    await save('task',3,'category',4,true);
    assert.equal(await field('estimate_categories',4,'predecessor_task_id'),3);
    assert.equal(await field('estimate_tasks',4,'predecessor_task_id'),null);
    // A child milestone cannot make its own group depend on itself.
    await assert.rejects(save('task',3,'category',2,true), error => error.code==='22023' && /circular/.test(error.message));
    assert.equal(await field('estimate_categories',4,'predecessor_task_id'),3);
    // Numeric IDs overlap between the two row types; these are different rows.
    await save('category',1,'task',1,true);
    assert.equal(await field('estimate_tasks',1,'predecessor_category_id'),1);
    await save('task',3,'task',2,true);
    await assert.rejects(save('task',2,'task',3,false), error => error.code==='22023' && /circular/.test(error.message));
    assert.equal(await field('estimate_tasks',2,'predecessor_task_id'),3);
    for (const args of [['category',1,'category',1,true],['category',1,'category',8,true],['task',3,'task',8,true],['task',2,'task',4,false],['category',4,'category',2,false]]) {
      await assert.rejects(save(...args), error => error.code==='22023');
    }
    await assert.rejects(save('task',3,'task',4,false), error => error.code==='22023');
    assert.equal(await field('estimate_tasks',3,'is_milestone'),true);
    // Clearing outgoing links must preserve this milestone's own predecessor.
    await save('task',3,'category',1,true);
    await save('category',1,null,null,true);
    assert.equal(await field('estimate_categories',1,'predecessor_task_id'),3);
    assert.equal(await field('estimate_tasks',1,'predecessor_category_id'),null);
    await assert.rejects(save('category',9,'category',1,true,3), error => error.code==='42501');
    await assert.rejects(save('category',1,'task',4,true,999), error => error.code==='42501');
    await db.exec("set test.session='expired'");
    await assert.rejects(save('category',1,'task',4,true), error => error.code==='42501');
    await db.exec("set test.session='active'; set test.maintenance='true'");
    await assert.rejects(save('category',1,'task',4,true), error => error.code==='55000');
    await db.exec("set test.maintenance='false'; reset role");
    assert.deepEqual((await db.query('select id,cost from estimate_categories order by id')).rows,oldCosts);
    assert.deepEqual((await db.query('select id,progress from estimate_tasks order by id')).rows,oldProgress);
    await db.exec('delete from estimate_tasks where id=3');
    assert.equal(await field('estimate_categories',1,'predecessor_task_id'),null);
    await db.exec('set role anon');
    await assert.rejects(save('category',1,'task',4,true), error => error.code==='42501');
  } finally { await db.close(); }
});
