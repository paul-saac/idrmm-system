import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import pg from 'pg';

const bin=process.env.IDRMM_TEST_PG_BIN??'C:\\Program Files\\PostgreSQL\\18\\bin';
const actor='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
test('offline SQL: atomic dated logs, resources, idempotency, conflicts, concurrency and authorization',{
 skip:!existsSync(join(bin,'initdb.exe')),timeout:150000,
},async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'idrmm-offline-sql-')),data=join(temporary,'data');
 assert.ok(resolve(data).startsWith(resolve(temporary)+ '\\'));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const run=(exe,args)=>execFileSync(join(bin,exe),args,{windowsHide:true,timeout:90000,stdio:exe==='pg_ctl.exe'?'ignore':'pipe'});
 let started=false;const clients=[];
 try{
  run('initdb.exe',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8','--no-sync']);
  run('pg_ctl.exe',['-D',data,'-l',join(temporary,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -F`,'-w','start']);started=true;
  const connect=async()=>{const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await c.connect();clients.push(c);return c;};
  const db=await connect();
  await db.query(`create role anon;create role authenticated;create schema auth;
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
   create function app_session_is_active() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'yes')='yes'$$;
   create function invitation_setup_complete() returns boolean language sql as $$select coalesce(current_setting('test.invite',true),'yes')='yes'$$;
   create function get_my_role() returns text language sql as $$select coalesce(current_setting('test.role',true),'foreman')$$;
   create table profiles(id uuid primary key,first_name text,last_name text);insert into profiles values('${actor}','Field','Member'),('${other}','Other','Member');
   create table projects(id bigint primary key,access text);insert into projects values(1,'edit'),(2,'view'),(3,'none');
   create function project_access_level(bigint) returns text language sql security definer as $$select access from projects where id=$1$$;
   create function system_backup_maintenance() returns boolean language sql as $$select coalesce(current_setting('test.maintenance',true),'off')='on'$$;
   create function system_backup_write_guard() returns trigger language plpgsql as $$begin if system_backup_maintenance() then raise exception 'Paused';end if;return coalesce(new,old);end$$;
   create table workers(id bigint primary key,full_name text,category text,employment_type text,hourly_rate numeric);
   insert into workers values(5,'Hourly Worker','skilled','employee',100),(6,'Subcontractor','skilled','subcontractor',null);
   create table estimate_categories(id bigint primary key,project_id bigint,estimated_quantity numeric,is_milestone boolean default false);
   create table estimate_tasks(id bigint primary key,project_id bigint,category_id bigint,estimated_quantity numeric,is_milestone boolean default false);
   insert into estimate_categories(id,project_id,estimated_quantity) values(1,1,100),(2,1,100);
   insert into estimate_tasks(id,project_id,category_id,estimated_quantity) values(1,1,1,100),(2,1,1,100);
   insert into estimate_tasks values(3,1,1,0,true);
   create table progress_override_logs(id bigint generated always as identity primary key,project_id bigint,task_id bigint,category_id bigint,entry_date date,action text,quantity_completed numeric,labor_cost numeric,material_cost numeric,equipment_cost numeric,other_cost numeric,materials_used jsonb default '[]',attendance jsonb default '[]',equipment_costs jsonb default '[]',other_costs jsonb default '[]',saved_by uuid,saved_by_name text,created_at timestamptz default now());`);
  for(const kind of ['task','category'])await db.query(`
   create table ${kind}_progress_entries(id bigint generated always as identity primary key,${kind}_id bigint,entry_date date,quantity_completed numeric,labor_cost numeric default 0,material_cost numeric default 0,equipment_cost numeric default 0,other_cost numeric default 0,recorded_by uuid,created_at timestamptz default now(),unique(${kind}_id,entry_date));
   create table ${kind}_progress_attendance(id bigint generated always as identity primary key,progress_entry_id bigint,worker_id bigint,worker_name text,hours numeric,hourly_rate numeric);
   create table ${kind}_progress_material_entries(id bigint generated always as identity primary key,progress_entry_id bigint,material_name text,unit text,quantity_used numeric,unit_cost numeric);
   create table ${kind}_progress_equipment_cost_entries(id bigint generated always as identity primary key,progress_entry_id bigint,cost_name text,amount numeric,unplanned boolean);
   create table ${kind}_progress_other_cost_entries(id bigint generated always as identity primary key,progress_entry_id bigint,cost_name text,amount numeric,unplanned boolean);`);
  await db.query(`create function attendance_elsewhere(d date,w bigint[],t bigint,c bigint) returns table(hours numeric) language sql as $$
    select a.hours from task_progress_attendance a join task_progress_entries e on e.id=a.progress_entry_id where e.entry_date=d and a.worker_id=any(w) and (t is null or e.task_id<>t)
    union all select a.hours from category_progress_attendance a join category_progress_entries e on e.id=a.progress_entry_id where e.entry_date=d and a.worker_id=any(w) and (c is null or e.category_id<>c)$$;`);
  for(const file of ['0122_progress_quantity_limits.sql','0127_edit_saved_progress_logs.sql','0128_project_members_edit_progress_logs.sql','0129_subcontractor_daily_labor_amounts.sql','0145_offline_progress_synchronization.sql'])await db.query(readFileSync('supabase/migrations/'+file,'utf8'));
  await db.query(`grant usage on schema public,auth to authenticated;grant select on all tables in schema public to authenticated;
   alter table estimate_tasks enable row level security;create policy readonly on estimate_tasks for select to authenticated using(true);`);
  const setup=async(c)=>c.query(`set test.actor='${actor}';set role authenticated`);await setup(db);
  const input=()=>({quantityCompletedToday:20,costs:{labor:0,material:0,equipment:0,other:0},attendance:[{workerId:5,hours:8},{workerId:6,hours:0,amount:1500}],materialsUsed:[{name:'Sand',unit:'cu.m',quantity:2}],unplannedMaterials:[{name:'Water',unit:'liters',quantity:1,unitCost:10}],equipmentCostsUsed:[{name:'Mixer',amount:100}],unplannedEquipmentCosts:[],otherCostsUsed:[],unplannedOtherCosts:[{name:'Delivery',amount:50}]});
  const save=(c,id,kind='task',item=1,date='2026-01-02',version=null,payload=input(),owner=actor,project=1)=>c.query('select synchronize_offline_progress($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[id,owner,project,kind,item,date,'2026-01-10T00:00:00Z',version,payload]).then(r=>r.rows[0].result);
  const state=async(kind='task',id=1,date='2026-01-02')=>(await db.query('select offline_project_progress(1,$1) states',[date])).rows[0].states[`${kind}-${id}`];
  assert.equal((await state()).version,null);
  const id=crypto.randomUUID(),receipt=await save(db,id);assert.equal(receipt.state.totalQuantity,20);assert.equal(receipt.state.input.attendance[1].amount,1500);assert.equal(receipt.state.input.costs.equipment,0);
  assert.equal(Number((await db.query('select labor_cost from task_progress_entries')).rows[0].labor_cost),2300);
  assert.equal((await db.query('select entry_date::text from task_progress_entries')).rows[0].entry_date,'2026-01-02');
  assert.equal((await db.query('select count(*)::int n from progress_override_logs')).rows[0].n,1,'temporary anchor must not survive');
  assert.equal((await save(db,id)).replayed,true);assert.equal((await db.query('select count(*)::int n from task_progress_entries')).rows[0].n,1);
  await assert.rejects(save(db,id,'task',1,'2026-01-02',null,{...input(),quantityCompletedToday:21}),/identifier/);
  await assert.rejects(save(db,crypto.randomUUID()),/changed after/);
  await save(db,crypto.randomUUID(),'task',1,'2026-01-02',receipt.state.version,{...input(),quantityCompletedToday:25});
  assert.equal((await db.query('select count(*)::int n from progress_override_logs')).rows[0].n,2);
  assert.equal((await state()).totalQuantity,25);
  const excess={...input(),quantityCompletedToday:76};await assert.rejects(save(db,crypto.randomUUID(),'task',1,'2026-01-03',null,excess),/remaining planned quantity/);
  assert.equal((await db.query('select count(*)::int n from task_progress_entries')).rows[0].n,1,'failed first save must roll back its zero entry');
  const category=await save(db,crypto.randomUUID(),'category',2);assert.equal(category.state.totalQuantity,20);
  await assert.rejects(save(db,crypto.randomUUID(),'category',1),/no longer available/);
  await assert.rejects(save(db,crypto.randomUUID(),'task',3),/no longer available/);
  await assert.rejects(save(db,crypto.randomUUID(),'task',1,'2026-01-03',null,input(),other),/original account/);
  await assert.rejects(save(db,crypto.randomUUID(),'task',1,'2026-01-03',null,input(),actor,2),/project access/);
  await db.query("set test.active='no'");await assert.rejects(save(db,crypto.randomUUID()),/original account/);await db.query("set test.active='yes';set test.maintenance='on'");
  await assert.rejects(save(db,crypto.randomUUID()),/paused/);await db.query("set test.maintenance='off'");
  await assert.rejects(db.query("insert into offline_progress_submissions(id) values(gen_random_uuid())"),/permission denied/);
  await assert.rejects(db.query('select _offline_progress_state(\'task\',1,\'2026-01-02\')'),/permission denied/);
  // Simultaneous submissions with the same id commit exactly once.
  const a=await connect(),b=await connect();await setup(a);await setup(b);const concurrent=crypto.randomUUID();
  const results=await Promise.all([save(a,concurrent,'task',2,'2026-01-03'),save(b,concurrent,'task',2,'2026-01-03')]);
  assert.equal(results.filter(r=>r.replayed).length,1);
  assert.equal((await db.query("select count(*)::int n from task_progress_entries where task_id=2")).rows[0].n,1);
  // Different tasks sharing a worker cannot exceed 24 hours, including races.
  const many={...input(),attendance:[{workerId:5,hours:16}]};
  const settled=await Promise.allSettled([save(a,crypto.randomUUID(),'task',1,'2026-01-04',null,many),save(b,crypto.randomUUID(),'task',2,'2026-01-04',null,many)]);
  assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
  assert.match(settled.find(r=>r.status==='rejected').reason.message,/24/);
  await db.query('reset role');await db.query(`alter table task_progress_other_cost_entries add constraint reject_delivery check(cost_name<>'Delivery') not valid`);
  await setup(db);const before=(await db.query('select count(*)::int n from offline_progress_submissions')).rows[0].n;
  await assert.rejects(save(db,crypto.randomUUID(),'task',2,'2026-01-05'),/reject_delivery/);
  assert.equal((await db.query('select count(*)::int n from offline_progress_submissions')).rows[0].n,before);
  assert.equal((await db.query("select count(*)::int n from task_progress_entries where entry_date='2026-01-05'")).rows[0].n,0);
 }finally{
  await Promise.allSettled(clients.map(c=>c.end()));if(started)run('pg_ctl.exe',['-D',data,'-m','immediate','-w','stop']);
  if(resolve(temporary).startsWith(resolve(tmpdir())+'\\'))rmSync(temporary,{recursive:true,force:true});
 }
});
