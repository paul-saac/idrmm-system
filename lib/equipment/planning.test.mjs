import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
let PGlite;
try {({PGlite}=require('@electric-sql/pglite'));}catch{/* Optional SQL integration dependency. */}
const migration=readFileSync(new URL('../../supabase/migrations/0131_company_equipment_task_planning.sql',import.meta.url),'utf8');
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select case when coalesce(current_setting('test.auth',true),'yes')='yes' then '00000000-0000-0000-0000-000000000001'::uuid end$$;
 create function get_my_role() returns text language sql as $$select coalesce(current_setting('test.role',true),'admin')$$;
 create function app_session_is_active() returns boolean language sql as $$select coalesce(current_setting('test.active',true),'yes')='yes'$$;
 create function invitation_setup_complete() returns boolean language sql as $$select coalesce(current_setting('test.setup',true),'yes')='yes'$$;
 create function system_backup_maintenance() returns boolean language sql as $$select coalesce(current_setting('test.backup',true),'no')='yes'$$;
 create function project_access_level(bigint) returns text language sql as $$select case when $1=3 then 'view'
   when $1 in (1,2) and (get_my_role() in ('admin','super_admin') or $1=1) then coalesce(nullif(current_setting('test.access',true),''),'edit') else 'none' end$$;
 create table projects(id bigint primary key,project_name text,archived_at timestamptz);
 insert into projects values(1,'Planning Project',null),(2,'Private Project',null),(3,'Archived Project',now());
 create table estimate_categories(id bigint primary key,project_id bigint,category_name text,planned_start_date date,planned_end_date date);
 insert into estimate_categories values(1,1,'Phase',null,null),(2,1,'Standalone','2026-11-10','2026-11-11'),(3,2,'Private Phase',null,null);
 create table estimate_tasks(id bigint primary key,project_id bigint,category_id bigint,task_name text,planned_start_date date,planned_end_date date);
 insert into estimate_tasks values(10,1,1,'First','2026-11-02','2026-11-04'),(11,1,1,'Next','2026-11-06','2026-11-08'),(20,2,3,'Confidential task','2026-11-03','2026-11-05');
 create table equipment(id bigint primary key,name text,asset_tag text,status text,current_project_id bigint);
 insert into equipment values(1,'Truck','EQ-001','assigned',2),(2,'Mixer','EQ-002','available',null),(3,'Drill','EQ-003','maintenance',null),(4,'Old Tool','EQ-004','retired',null);
 create table equipment_assignments(id bigint primary key,equipment_id bigint,project_id bigint,returned_at timestamptz);
 insert into equipment_assignments values(9,1,2,null);
 create table equipment_task_assignments(id bigint primary key,equipment_assignment_id bigint,project_id bigint,task_id bigint,category_id bigint,task_name text,assigned_at timestamptz,released_at timestamptz);
 insert into equipment_task_assignments values(90,9,2,20,null,'Confidential task',now(),null);
 create table equipment_task_plans(project_id bigint not null references projects(id),item_key text not null,equipment_id bigint not null references equipment(id),primary key(project_id,item_key,equipment_id));
 insert into equipment_task_plans values(2,'task-20',1);
 `);
 await db.exec(migration);return db;
}
const save=(db,selected,previous,key='task-10',project=1)=>db.query('select save_equipment_task_plans($1,$2,$3,$4)',[project,key,selected,previous]);
const snapshot=async(db,project=1)=>(await db.query('select equipment_tracking_data($1) data',[project])).rows[0].data;

test('free equipment and equipment checked out elsewhere can be planned without moving physical checkouts',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  const before=(await db.query('select * from equipment order by id')).rows;
  await save(db,[1,2],[]);await save(db,[1,2],[]);
  assert.equal((await snapshot(db)).plans.length,2);
  assert.deepEqual((await db.query('select * from equipment order by id')).rows,before);
  assert.equal((await db.query('select count(*)::int n from equipment_assignments')).rows[0].n,1);
  assert.equal((await db.query('select released_at from equipment_task_assignments')).rows[0].released_at,null);
  await save(db,[2],[],'category-2');
  assert.equal((await snapshot(db)).equipment.find(row=>row.id===1).location,'Private Project');
 }finally{await db.close();}
});

test('overlapping plans warn without blocking; non-overlapping schedules have no conflict',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  let data=await snapshot(db);
  assert.ok(data.conflicts.some(row=>row.equipmentId===1&&row.itemKey==='task-10'));
  assert.ok(!data.conflicts.some(row=>row.equipmentId===1&&row.itemKey==='task-11'));
  await save(db,[1],[]);
  assert.equal((await snapshot(db)).plans[0].equipmentId,1);
  await db.exec("update estimate_tasks set planned_start_date='2026-11-06',planned_end_date='2026-11-07' where id=10");
  data=await snapshot(db);assert.ok(!data.conflicts.some(row=>row.equipmentId===1&&row.itemKey==='task-10'));
 }finally{await db.close();}
});

test('unavailable assets cannot be newly planned, while existing allocations remain removable',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  for(const id of [3,4,999])await assert.rejects(save(db,[id],[]),/cannot be newly allocated/);
  await save(db,[2],[]);await db.exec("update equipment set status='maintenance' where id=2");
  assert.ok((await snapshot(db)).equipment.some(row=>row.id===2&&row.status==='maintenance'));
  await save(db,[1,2],[2]);await save(db,[],[1,2]);
  assert.equal((await snapshot(db)).plans.length,0);
  assert.equal((await db.query('select status from equipment where id=2')).rows[0].status,'maintenance');
 }finally{await db.close();}
});

test('role/project/session guards and stale-selection rejection protect task plans',{skip:!PGlite},async()=>{
 const db=await fixture();try{
  for(const role of ['project_manager','foreman']){
   await db.query("select set_config('test.role',$1,false)",[role]);await save(db,[1],[]);await save(db,[],[1]);
   await assert.rejects(save(db,[1],[],'task-20',2),/Not authorized/);
   const data=await snapshot(db);assert.equal(data.equipment.find(row=>row.id===1).currentProjectId,null);
   assert.equal(data.equipment.find(row=>row.id===1).location,'Assigned to another project');
   assert.ok(!JSON.stringify(data).includes('Private Project'));assert.ok(!JSON.stringify(data).includes('Confidential task'));
   assert.ok(data.conflicts.some(row=>row.equipmentId===1));
  }
  await db.exec("set test.role='admin'");await save(db,[1],[]);
  await assert.rejects(save(db,[],[]),/Assignments changed/);
  await assert.rejects(save(db,[1],[],'category-1'),/valid task/);
  await assert.rejects(save(db,[1],[],'task-20'),/valid task/);
  await assert.rejects(save(db,[1],[],'task-10',3),/Not authorized/);
  for(const key of ['active','setup','auth']){
   await db.query('select set_config($1,$2,false)',['test.'+key,'no']);
   await assert.rejects(snapshot(db),/Not authorized/);await assert.rejects(save(db,[],[1]),/Not authorized/);
   await db.query('select set_config($1,$2,false)',['test.'+key,'yes']);
  }
  await db.exec("set test.backup='yes'");await assert.rejects(save(db,[],[1]),/temporarily paused/);
  assert.equal((await db.query('select count(*)::int n from equipment_task_plans where project_id=1')).rows[0].n,1);
 }finally{await db.close();}
});

function load(file,mocks={}){
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText,{exports,require:name=>mocks[name]??{},Set});return exports;
}
const jsx=(type,props)=>({type,props});
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null?'':typeof value!=='object'?String(value):Array.isArray(value)?value.map(text).join(''):text(value.props?.children);

test('picker allows other-project selections without inline overlap messages and disables maintenance checkboxes',async()=>{
 const data={equipment:[
  {id:1,name:'Truck',assetTag:'EQ-001',status:'assigned',currentProjectId:2,location:'Other Project'},
  {id:2,name:'Mixer',assetTag:'EQ-002',status:'maintenance',currentProjectId:null,location:'Under maintenance'},
 ],plans:[],conflicts:[{itemKey:'task-10',equipmentId:1}]};
 const states=[],calls=[];let cursor=0;
 const {EquipmentTrackingPanel}=load('../../components/projects/equipment/equipment-tracking-panel.tsx',{
  react:{useState(initial){const slot=cursor++;if(!(slot in states))states[slot]=typeof initial==='function'?initial():initial;
   return[states[slot],value=>{states[slot]=typeof value==='function'?value(states[slot]):value;}];},useEffect(){}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({refresh:()=>calls.push(['refresh'])})},
  '@/lib/equipment/tracking-actions':{saveEquipmentPlans:async(...args)=>{calls.push(args);return{};}},
  '@/components/ui/modal':{ModalFooter:'footer'},
 });
 const render=readOnly=>{cursor=0;return EquipmentTrackingPanel({projectId:1,itemKey:'task-10',initialData:data,readOnly,onChange:next=>calls.push(['change',next])});};
 let tree=render(false);let inputs=nodes(tree).filter(node=>node.type==='input'&&node.props.type==='checkbox');
 assert.equal(inputs.length,2);assert.equal(inputs[0].props.disabled,false);assert.equal(inputs[1].props.disabled,true);assert.equal(inputs[1].props.checked,false);
 const maintenanceRow=nodes(tree).find(n=>n.type==='tr'&&text(n).includes('Mixer'));
 assert.equal(maintenanceRow.props.className,'bg-red-50');
 assert.match(text(maintenanceRow),/Under Maintenance/);
 assert.ok(nodes(maintenanceRow).some(n=>n.type==='span'&&n.props?.className?.includes('text-zinc-400')&&text(n).includes('Mixer')));
 assert.ok(!text(tree).includes('Overlapping planned allocation'));assert.match(text(tree),/Assigned/);assert.ok(!text(tree).includes('Other Project'));
 assert.ok(!nodes(tree).some(node=>node.props?.className?.includes('max-h-80')));
 inputs[0].props.onChange();tree=render(false);
 assert.ok(!nodes(tree).some(node=>node.props?.role==='status'));
 assert.ok(!text(tree).includes('Non-overlapping task dates can still be allocated.'));
 await nodes(tree).find(node=>node.type==='button'&&text(node)==='Save').props.onClick();
 assert.equal(calls[0][0],1);assert.equal(calls[0][1],'task-10');assert.equal(calls[0][2][0],1);
 assert.equal(nodes(render(true)).filter(node=>node.type==='input'&&node.props.type==='checkbox').every(node=>node.props.disabled),true);
});


test('picker retains selections and opens the blocking modal when the database reports a conflict',async()=>{
 const data={equipment:[{id:1,name:'Truck',assetTag:'EQ-001',status:'assigned',location:'Other Project'}],plans:[]};
 const conflict={equipment:'Truck',task:'Footings',startDate:'2026-11-06',endDate:'2026-11-08'};
 const states=[];let cursor=0;const changed=[];
 const {EquipmentTrackingPanel}=load('../../components/projects/equipment/equipment-tracking-panel.tsx',{
  react:{useState(initial){const slot=cursor++;if(!(slot in states))states[slot]=typeof initial==='function'?initial():initial;
   return[states[slot],value=>{states[slot]=typeof value==='function'?value(states[slot]):value;}];},useEffect(){}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({refresh(){throw Error('Should not refresh failed save');}})},
  '@/lib/equipment/tracking-actions':{saveEquipmentPlans:async()=>({error:'Conflict',conflict})},
  '@/components/inventory/equipment-conflict-dialog':{EquipmentConflictDialog:'conflict-dialog'},
  '@/components/ui/modal':{ModalFooter:'footer'},
 });
 const render=()=>{cursor=0;return EquipmentTrackingPanel({projectId:1,itemKey:'task-10',initialData:data,onChange:next=>changed.push(next)});};
 let tree=render();nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange();
 await nodes(render()).find(n=>n.type==='button'&&text(n)==='Save').props.onClick();
 tree=render();assert.equal(nodes(tree).find(n=>n.type==='conflict-dialog').props.conflict.task,'Footings');
 assert.equal(nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,true);assert.equal(changed.length,0);
});


test('picker has equipment/status columns and shows equipment status instead of project names',()=>{
 const usage=load('./usage-status.ts',{'@/lib/cost-estimate/schedule-dates':load('../cost-estimate/schedule-dates.ts')});
 const data={equipment:[{id:1,name:'Truck',assetTag:'EQ-001',status:'assigned',location:'La Colina',allocations:[
  {projectId:1,projectName:'La Colina',itemKey:'task-1',startDate:'2026-11-03',endDate:'2026-11-04'},
  {projectId:1,projectName:'La Colina',itemKey:'task-2',startDate:'2026-11-09',endDate:'2026-11-10'},
 ]}],plans:[]};
 const {EquipmentTrackingPanel}=load('../../components/projects/equipment/equipment-tracking-panel.tsx',{
  react:{useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect(){}},
  'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({})},
  '@/lib/equipment/usage-status':usage,'@/components/ui/modal':{ModalFooter:'footer'},
 });
 const tree=EquipmentTrackingPanel({projectId:1,itemKey:'task-3',initialData:data});
 assert.deepEqual(nodes(tree).filter(n=>n.type==='th').map(text),['Equipment name','Status']);
 assert.ok(!text(tree).includes('La Colina'));
 assert.match(text(tree),/Assigned/);
 assert.ok(!text(tree).includes("11/3/2026"));
 assert.ok(!text(tree).includes("11/9/2026"));
});
