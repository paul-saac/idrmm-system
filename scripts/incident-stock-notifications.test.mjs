import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const migration = readFileSync(new URL('../supabase/migrations/0152_incident_and_stock_notifications.sql', import.meta.url),'utf8');
const original = readFileSync(new URL('../supabase/migrations/0096_project_safety_incidents.sql', import.meta.url),'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function setup() {
 const db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create schema auth;
 alter default privileges grant execute on functions to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,first_name text,last_name text,role text,status text default 'active',invitation_pending boolean default false);
 create table projects(id bigint primary key,project_name text,project_manager_id uuid,foreman_id uuid,archived_at timestamptz);
 create table notifications(id bigint generated always as identity,recipient_id uuid,actor_id uuid,actor_name text,kind text constraint notifications_kind_check check(kind in ('safety_incident')),project_id bigint,project_name text,item_kind text constraint notifications_item_kind_check check(item_kind in ('incident')),item_id bigint,item_name text,entry_date date);
 create table project_safety_incidents(id bigint primary key,project_id bigint,reported_by uuid,reporter_name text,incident_type text,occurred_on date,closeout jsonb);
 create table estimate_categories(id bigint primary key,project_id bigint);
 create table estimate_tasks(id bigint primary key,project_id bigint);
 create table category_progress_entries(id bigint primary key,category_id bigint);
 create table task_progress_entries(id bigint primary key,task_id bigint);
 create table material_purchases(id bigint primary key,project_id bigint,material_name text,unit text,received_quantity numeric);
 create table category_progress_material_entries(id bigint primary key,progress_entry_id bigint references category_progress_entries on delete cascade,material_name text,unit text,quantity_used numeric);
 create table task_progress_material_entries(id bigint primary key,progress_entry_id bigint references task_progress_entries on delete cascade,material_name text,unit text,quantity_used numeric);
 insert into profiles(id,first_name,last_name,role) values
 ('${id(1)}','Super','Admin','super_admin'),('${id(2)}','Owner','Admin','admin'),
 ('${id(3)}','Project','Manager','project_manager'),('${id(4)}','Site','Foreman','foreman'),
 ('${id(5)}','Other','Foreman','foreman'),('${id(6)}','Pending','Admin','admin'),('${id(7)}','Inactive','Admin','admin');
 update profiles set invitation_pending=true where id='${id(6)}';
 update profiles set status='inactive' where id='${id(7)}';
 insert into projects values(101,'Fixture project','${id(3)}','${id(4)}',null),(102,'Other project','${id(5)}','${id(5)}',null);
 insert into estimate_categories values(201,101); insert into estimate_tasks values(301,101);
 insert into category_progress_entries values(401,201); insert into task_progress_entries values(501,301);
 `);
 await db.exec(original.match(/create function public\.notify_safety_incident\(\)[\s\S]*?\$\$;/i)[0]);
 await db.exec(`create trigger report_notice after insert on project_safety_incidents for each row execute function notify_safety_incident();`);
 await db.exec(migration);
 await db.exec(`create trigger delete_notice after delete on project_safety_incidents for each row execute function delete_safety_incident_notifications();`);
 return db;
}
const recipients=async(db,kind)=>(await db.query('select recipient_id from notifications where kind=$1 order by recipient_id',[kind])).rows.map(r=>r.recipient_id);
const count=async(db)=>(await db.query("select count(*)::int n from notifications where kind='material_out_of_stock'")).rows[0].n;
test('Foreman incident and PM closeout notify the other authorized supervisors; deletion clears both',async()=>{
 const db=await setup();try{
 await db.exec(`insert into project_safety_incidents values(1,101,'${id(4)}','Site Foreman','injury',current_date,null)`);
 assert.deepEqual(await recipients(db,'safety_incident'),[id(1),id(2),id(3)]);
 await db.query(`update project_safety_incidents set closeout=$1 where id=1`,[JSON.stringify({closedBy:id(3),closedByName:'Project Manager'})]);
 assert.deepEqual(await recipients(db,'incident_closed'),[id(1),id(2),id(4)]);
 await db.exec(`update project_safety_incidents set closeout=closeout where id=1`);
 assert.equal((await recipients(db,'incident_closed')).length,3);
 await db.exec('delete from project_safety_incidents where id=1');
 assert.deepEqual((await db.query('select * from notifications')).rows,[]);
 }finally{await db.close();}
});
test('final committed stock combines task and category usage and notifies all four roles including the actor',async()=>{
 const db=await setup();try{
 await db.exec(`select set_config('request.jwt.claim.sub','${id(4)}',false);
 begin;
 insert into material_purchases values(1,101,'Cement','bags',10);
 insert into category_progress_material_entries values(1,401,'Cement','bags',4);
 insert into task_progress_material_entries values(1,501,'Cement','bags',6);
 `);
 assert.equal(await count(db),0,'no notice during an incomplete transaction');
 await db.exec('commit');
 assert.deepEqual(await recipients(db,'material_out_of_stock'),[id(1),id(2),id(3),id(4)]);
 assert.equal((await db.query("select item_name from notifications limit 1")).rows[0].item_name,'cement (bags)');
 }finally{await db.close();}
});
test('editing/replacing log resource rows does not spam; replenishment rearms the next depletion',async()=>{
 const db=await setup();try{
 await db.exec(`begin;insert into material_purchases values(1,101,'Cement','bags',10);insert into task_progress_material_entries values(1,501,'Cement','bags',10);commit;`);
 assert.equal(await count(db),4);
 await db.exec(`begin;delete from task_progress_material_entries where id=1;insert into task_progress_material_entries values(2,501,'Cement','bags',10);commit;`);
 assert.equal(await count(db),4);
 await db.exec(`update material_purchases set received_quantity=20 where id=1`);
 assert.equal(await count(db),4);
 await db.exec(`update task_progress_material_entries set quantity_used=20 where id=2`);
 assert.equal(await count(db),8);
 await db.exec(`update task_progress_material_entries set quantity_used=21 where id=2`);
 assert.equal(await count(db),8,'negative stock stays exhausted, without a repeat alert');
 }finally{await db.close();}
});
test('rolled-back changes and empty zero receipts do not notify; parent log deletion rearms stock',async()=>{
 const db=await setup();try{
 await db.exec(`insert into material_purchases values(1,101,'Cement','bags',0)`);
 assert.equal(await count(db),0);
 await db.exec(`begin;update material_purchases set received_quantity=10;insert into task_progress_material_entries values(1,501,'Cement','bags',10);rollback;`);
 assert.equal(await count(db),0);
 await db.exec(`begin;update material_purchases set received_quantity=10;insert into task_progress_material_entries values(1,501,'Cement','bags',10);commit;`);
 assert.equal(await count(db),4);
 await db.exec('delete from task_progress_entries where id=501');
 await db.exec(`begin;insert into task_progress_entries values(502,301);insert into task_progress_material_entries values(2,502,'Cement','bags',10);commit;`);
 assert.equal(await count(db),8);
 assert.equal((await db.query("select count(*)::int n from notifications where project_id=102")).rows[0].n,0);
 assert.equal((await db.query("select has_table_privilege('authenticated','material_stock_notification_state','SELECT') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('authenticated','check_project_stock_notifications(bigint)','EXECUTE') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
