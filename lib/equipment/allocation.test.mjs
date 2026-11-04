import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{}
const sql=n=>readFileSync(new URL('../../supabase/migrations/'+n,import.meta.url),'utf8');
async function fixture(){
 const db=new PGlite();
 // Reuse the prior migration's explicit fixture, not any live project records.
 const source=readFileSync(new URL('./planning.test.mjs',import.meta.url),'utf8');
 await db.exec(source.match(/await db.exec\(`([\s\S]*?)`\);/)[1]);
 await db.exec(`
 alter table equipment add last_assigned_at timestamptz,add last_returned_at timestamptz;
 alter table equipment_assignments add assigned_at timestamptz default now(),add assigned_by uuid,add notes text;
 alter table equipment_task_assignments add release_reason text;
 alter table estimate_tasks add estimated_quantity numeric default 100,add labor_estimate numeric default 0,add material_estimate numeric default 0,add equipment_estimate numeric default 0,add other_cost_estimate numeric default 0;
 alter table estimate_categories add estimated_quantity numeric default 100,add category_labor_estimate numeric default 0,add category_material_estimate numeric default 0,add category_equipment_estimate numeric default 0,add category_other_estimate numeric default 0;
 create table task_progress_entries(id bigint primary key,task_id bigint references estimate_tasks(id) on delete cascade,quantity_completed numeric default 0,labor_cost numeric default 0,material_cost numeric default 0,equipment_cost numeric default 0,other_cost numeric default 0);
 create table category_progress_entries(id bigint primary key,category_id bigint references estimate_categories(id) on delete cascade,quantity_completed numeric default 0,labor_cost numeric default 0,material_cost numeric default 0,equipment_cost numeric default 0,other_cost numeric default 0);
 create table task_progress_material_entries(id bigint primary key,progress_entry_id bigint references task_progress_entries(id) on delete cascade,material_name text,unit text,quantity_used numeric,unit_cost numeric);
 create table category_progress_material_entries(id bigint primary key,progress_entry_id bigint references category_progress_entries(id) on delete cascade,material_name text,unit text,quantity_used numeric,unit_cost numeric);
 create table estimate_task_material_assignments(id bigint primary key,task_id bigint references estimate_tasks(id) on delete cascade,material_name text,unit text,planned_quantity numeric,unit_cost numeric,amount numeric);
 create table estimate_category_material_assignments(id bigint primary key,category_id bigint references estimate_categories(id) on delete cascade,material_name text,unit text,planned_quantity numeric,unit_cost numeric,amount numeric);
 `);
 await db.exec(sql('0130_equipment_maintenance_status.sql'));
 await db.exec(sql('0131_company_equipment_task_planning.sql'));
 await db.exec('create function close_equipment_task_assignment(bigint,bigint,timestamptz default now()) returns void language sql as $$$$');
 await db.exec(sql('0132_equipment_allocation_availability.sql'));
 await db.exec(sql('0134_equipment_conflict_project_name.sql'));
 await db.exec(sql('0135_equipment_picker_allocation_dates.sql'));
 await db.exec(sql('0136_equipment_latest_task_assignment.sql'));
 const guards=sql('0087_equipment_progress_movements.sql');
 await db.exec(guards.slice(guards.indexOf('create or replace function public.guard_equipment_checkout'),guards.indexOf('create or replace function public.equipment_tracking_data')));

 return db;
}
const save=(db,selected,previous,key='task-10',project=1)=>db.query('select save_equipment_task_plans($1,$2,$3,$4)',[project,key,selected,previous]);
const status=async(db,id)=>(await db.query('select status,current_project_id from equipment where id=$1',[id])).rows[0];

test('overlap blocks atomically with authorized task and date details; inclusive endpoints conflict',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await assert.rejects(save(db,[1,2],[]),e=>{const d=JSON.parse(e.detail);assert.equal(d.equipmentConflict,true);assert.equal(d.task,'Confidential task');assert.equal(d.projectName,'Private Project');assert.equal(d.startDate,'2026-11-03');return true;});
  assert.equal((await db.query('select count(*)::int n from equipment_task_plans where project_id=1')).rows[0].n,0);
  await save(db,[1],[],'task-11');
  await db.exec("update estimate_categories set planned_start_date='2026-11-08',planned_end_date='2026-11-10' where id=2");
  await assert.rejects(save(db,[1],[],'category-2'),/overlapping/);
 }finally{await db.close();}
});

test('completion releases equipment; correcting/deleting progress reserves it again; future allocations keep Assigned',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await save(db,[2],[]);assert.equal((await status(db,2)).status,'assigned');
  await db.exec('insert into task_progress_entries(id,task_id,quantity_completed) values(1,10,100)');
  assert.equal((await status(db,2)).status,'available');
  await db.exec('update task_progress_entries set quantity_completed=60 where id=1');assert.equal((await status(db,2)).status,'assigned');
  await db.exec('update task_progress_entries set quantity_completed=100 where id=1');
  await save(db,[2],[],'task-11');assert.equal((await status(db,2)).status,'assigned');
  await db.exec('insert into task_progress_entries(id,task_id,quantity_completed) values(2,11,100)');assert.equal((await status(db,2)).status,'available');
  await db.exec('delete from task_progress_entries where id=1');assert.equal((await status(db,2)).status,'assigned');
 }finally{await db.close();}
});

test('physical project assignment closes automatically after its saved task completion; maintenance stays manual',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec('insert into task_progress_entries(id,task_id,quantity_completed) values(1,20,100)');
  assert.equal((await status(db,1)).status,'available');
  assert.ok((await db.query('select returned_at from equipment_assignments where id=9')).rows[0].returned_at);
  assert.ok((await db.query('select released_at from equipment_task_assignments where id=90')).rows[0].released_at);
  assert.equal((await db.query('select count(*)::int n from equipment_task_plans where equipment_id=1')).rows[0].n,1);
  await db.exec("update equipment set status='maintenance' where id=1;delete from task_progress_entries where id=1");
  assert.equal((await status(db,1)).status,'maintenance');
 }finally{await db.close();}
});

test('completion uses quantity first, then cost excluding unplanned material, then grouped material usage',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await save(db,[2],[]);
  await db.exec('insert into task_progress_entries(id,task_id,quantity_completed,labor_cost) values(1,10,10,9999)');
  assert.equal((await status(db,2)).status,'assigned');
  await db.exec('update estimate_tasks set estimated_quantity=0,labor_estimate=100 where id=10;update task_progress_entries set labor_cost=80,material_cost=20 where id=1;insert into task_progress_material_entries values(1,1,\'Unplanned\',\'pcs\',2,10)');
  assert.equal((await status(db,2)).status,'assigned');
  await db.exec('update task_progress_entries set labor_cost=100 where id=1');assert.equal((await status(db,2)).status,'available');
  await db.exec("update estimate_tasks set labor_estimate=0 where id=10;insert into estimate_task_material_assignments values(1,10,'Cement','bags',5,0,null),(2,10,' cement ','bags',5,0,null)");
  assert.equal((await status(db,2)).status,'assigned');
  await db.exec("insert into task_progress_material_entries values(2,1,'CEMENT','bags',10,null)");assert.equal((await status(db,2)).status,'available');
  await db.exec('delete from task_progress_material_entries where id=2');assert.equal((await status(db,2)).status,'assigned');
 }finally{await db.close();}
});

test('private conflicts hide protected records, invalid dates fail safely and session/project guards remain',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec("set test.role='project_manager'");
  await assert.rejects(save(db,[1],[]),e=>{assert.ok(!e.detail.includes('Confidential'));const d=JSON.parse(e.detail);assert.equal(d.startDate,null);assert.equal(d.projectName,null);assert.ok(!e.detail.includes('Private Project'));return true;});
  await db.exec("update estimate_tasks set planned_start_date=null where id=10");await assert.rejects(save(db,[2],[]),/valid task start/);
  await db.exec("set test.active='no'");await assert.rejects(save(db,[2],[]),/Not authorized/);
  await db.exec("set test.active='yes';set test.backup='yes'");await assert.rejects(save(db,[2],[]),/temporarily paused/);
  const functions=(await db.query("select proname,proacl::text acl from pg_proc where proname like '_equipment_%'")).rows;
  assert.ok(functions.every(f=>!f.acl.includes('authenticated=')&&!f.acl.includes('anon=')));
 }finally{await db.close();}
});


test('standalone task completion and maintenance completion use the same automatic availability source',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await save(db,[2],[],'category-2');assert.equal((await status(db,2)).status,'assigned');
  await db.exec('insert into category_progress_entries(id,category_id,quantity_completed) values(1,2,100)');assert.equal((await status(db,2)).status,'available');
  await db.exec('delete from category_progress_entries where id=1');assert.equal((await status(db,2)).status,'assigned');
  await db.query("select set_equipment_service_status(2,'assigned','maintenance')");
  await db.query("select set_equipment_service_status(2,'maintenance','available')");
  assert.equal((await status(db,2)).status,'assigned');
 }finally{await db.close();}
});

test('deferred reconciliation waits for the final edit and does not prematurely close assignment history',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec('begin;insert into task_progress_entries(id,task_id,quantity_completed) values(1,20,100);update task_progress_entries set quantity_completed=70 where id=1;commit;');
  assert.equal((await status(db,1)).status,'assigned');
  assert.equal((await db.query('select returned_at from equipment_assignments where id=9')).rows[0].returned_at,null);
  await db.exec('begin;update task_progress_entries set quantity_completed=100 where id=1;rollback;');
  assert.equal((await status(db,1)).status,'assigned');
 }finally{await db.close();}
});


test('equipment deletion cascades its allocations without deleting other equipment or saved progress',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await save(db,[2],[]);await save(db,[2],[],'task-11');
  await db.exec('insert into task_progress_entries(id,task_id,quantity_completed) values(1,10,100)');
  await assert.rejects(db.exec('delete from equipment where id=2'),/foreign key/);
  await db.exec(sql('0133_equipment_plan_delete_cascade.sql'));
  await db.exec('delete from equipment where id=2');
  assert.equal((await db.query('select count(*)::int n from equipment_task_plans where equipment_id=2')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from equipment where id=1')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from task_progress_entries where task_id=10')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from estimate_tasks where id=10')).rows[0].n,1);
 }finally{await db.close();}
});


test('picker snapshot returns separate unfinished allocation dates and masks private project schedules',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await save(db,[2],[]);await save(db,[2],[],'task-11');
  let assets=(await db.query('select equipment_tracking_data(1) data')).rows[0].data.equipment;
  const allocations=assets.find(e=>e.id===2).allocations;
  assert.equal(allocations.length,2);assert.equal(allocations[0].projectName,'Planning Project');
  assert.equal(allocations[0].startDate,'2026-11-02');assert.equal(allocations[0].endDate,'2026-11-04');
  assert.equal(allocations[1].startDate,'2026-11-06');
  await db.exec('insert into task_progress_entries(id,task_id,quantity_completed) values(1,10,100)');
  assets=(await db.query('select equipment_tracking_data(1) data')).rows[0].data.equipment;
  assert.equal(assets.find(e=>e.id===2).allocations.length,1);
  await db.exec("set test.role='project_manager'");
  assets=(await db.query('select equipment_tracking_data(1) data')).rows[0].data.equipment;
  assert.deepEqual(assets.find(e=>e.id===1).allocations,[]);
  assert.ok(!JSON.stringify(assets).includes('Private Project'));
 }finally{await db.close();}
});

test('allocation timestamp dates are shown as Manila calendar dates',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec("alter table estimate_tasks alter column planned_start_date type timestamptz using planned_start_date::timestamptz,alter column planned_end_date type timestamptz using planned_end_date::timestamptz");
  await db.exec("update estimate_tasks set planned_start_date='2026-11-02T16:00:00Z',planned_end_date='2026-11-03T16:00:00Z' where id=10");
  await save(db,[2],[]);
  const assets=(await db.query('select equipment_tracking_data(1) data')).rows[0].data.equipment;
  const dates=assets.find(e=>e.id===2).allocations[0];
  assert.equal(dates.startDate,'2026-11-03');assert.equal(dates.endDate,'2026-11-04');
 }finally{await db.close();}
});


test('latest task assignment records new allocations only, survives removal and ignores unchanged saves or rejected conflicts',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  const stamp=async id=>{const value=(await db.query('select last_task_assigned_at from equipment where id=$1',[id])).rows[0].last_task_assigned_at;return value?.toISOString?.()??value;};
  assert.equal(await stamp(1),null);assert.equal(await stamp(2),null);
  await save(db,[2],[]);const first=await stamp(2);assert.ok(first);
  await save(db,[2],[2]);assert.equal(await stamp(2),first);
  await save(db,[2],[],'task-11');const second=await stamp(2);assert.ok(new Date(second)>=new Date(first));
  await save(db,[],[2],'task-11');assert.equal(await stamp(2),second);
  await assert.rejects(save(db,[1,2],[2]),/overlapping/);
  assert.equal(await stamp(1),null);assert.equal(await stamp(2),second);
 }finally{await db.close();}
});


test('maintenance removes task allocations across projects and servicing does not restore them',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec(sql('0137_equipment_maintenance_clears_task_plans.sql'));
  const before=await db.query('select distinct project_id from equipment_task_plans where equipment_id=1 order by project_id');
  assert.ok(before.rows.length>0);
  const current=await status(db,1);
  const result=await db.query("select set_equipment_service_status(1,$1,'maintenance') result",[current.status]);
  for(const row of before.rows) assert.ok(result.rows[0].result.projectIds.includes(row.project_id));
  assert.equal((await db.query('select count(*)::int n from equipment_task_plans where equipment_id=1')).rows[0].n,0);
  assert.equal((await status(db,1)).status,'maintenance');
  await db.query("select set_equipment_service_status(1,'maintenance','available')");
  assert.equal((await status(db,1)).status,'available');
 }finally{await db.close();}
});


test('legacy checkout without task allocations no longer keeps equipment Assigned',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec(sql('0140_equipment_availability_uses_task_allocations.sql'));
  await db.exec("insert into equipment_assignments(id,equipment_id,project_id,assigned_at) values(999,2,1,now());update equipment set status='assigned',current_project_id=1 where id=2;select _equipment_sync_allocations(2)");
  assert.equal((await status(db,2)).status,'available');
  assert.ok((await db.query('select returned_at from equipment_assignments where equipment_id=2')).rows[0].returned_at);
 }finally{await db.close();}
});


test('catalog shares limited assignment summaries across projects but keeps project permissions unchanged',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec(sql('0141_equipment_catalog_assignment_summary.sql'));
  await db.exec("set test.role='foreman'");
  let rows=(await db.query('select equipment_catalog_assignment_summary() data')).rows[0].data;
  assert.equal(rows[0].projectName,'Private Project');
  assert.equal(rows[0].taskName,'Confidential task');
  assert.equal(rows[0].canViewProject,false);
  assert.ok(!('labor_cost' in rows[0]));
  assert.equal((await db.query('select project_access_level(2) access')).rows[0].access,'none');
  assert.equal(rows[0].useStatus,'planned');
  await db.exec('insert into task_progress_entries(id,task_id,quantity_completed) values(999,20,15)');
  rows=(await db.query('select equipment_catalog_assignment_summary() data')).rows[0].data;
  assert.equal(rows[0].useStatus,'ongoing');
  await db.exec('update task_progress_entries set quantity_completed=100 where id=999');
  rows=(await db.query('select equipment_catalog_assignment_summary() data')).rows[0].data;
  assert.equal(rows[0].useStatus,'completed');
  for(const setting of ['test.active','test.setup','test.auth']){
   await db.query('select set_config($1,$2,false)',[setting,'no']);
   await assert.rejects(db.query('select equipment_catalog_assignment_summary()'),/Not authorized/);
   await db.query('select set_config($1,$2,false)',[setting,'yes']);
  }
 }finally{await db.close();}
});


test('equipment picker lists maintenance inventory without allowing it to be assigned',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  await db.exec(sql('0142_equipment_picker_includes_full_inventory.sql'));
  const rows=(await db.query('select equipment_tracking_data(1) data')).rows[0].data.equipment;
  assert.equal(rows.length,4);
  assert.equal(rows.find(row=>row.id===3).status,'maintenance');
  assert.equal(rows.find(row=>row.id===4).status,'retired');
  await assert.rejects(save(db,[3],[],'task-11'),/maintenance or retired/);
  assert.equal((await db.query('select count(*)::int n from equipment_task_plans where equipment_id=3')).rows[0].n,0);
  await db.exec("set test.access='none'");
  await assert.rejects(db.query('select equipment_tracking_data(1)'),/Not authorized/);
 }finally{await db.close();}
});
