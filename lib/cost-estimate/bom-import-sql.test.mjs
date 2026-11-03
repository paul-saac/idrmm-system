import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{createRequire}from'node:module';import{runInNewContext}from'node:vm';
const require=createRequire(import.meta.url),{PGlite}=require('@electric-sql/pglite');
const baseURL=new URL('./nesting.test.mjs',import.meta.url);
const source=readFileSync(baseURL,'utf8').match(/async function fixture\(\) \{[\s\S]*?\n\}/)[0].replaceAll('import.meta.url',JSON.stringify(baseURL.href));
const binding={};runInNewContext(source+';exports.fixture=fixture;',{exports:binding,PGlite,readFileSync,URL});
async function fixture(){
 const db=await binding.fixture();try{
  await db.exec("alter table projects add column start_date date default '2026-11-02';");
  await db.exec(readFileSync(new URL('../../supabase/migrations/0125_atomic_reviewed_estimate_import.sql',import.meta.url),'utf8'));
  return db;
 }catch(e){await db.close();throw e;}
}
const concrete=[{name:'CONCRETE WORKS',tasks:[{name:'CONCRETE FOOTINGS',quantity:'',unit:'',materials:[
 {name:'Portland Cement',quantity:'30.00',unit:'bags.',unitCost:'210.00',amount:'6,300.00'},
 {name:'Screened sand',quantity:'1.00',unit:'cu.m.',unitCost:'1200.00',amount:'1,200.00'},
 {name:'" Gravel',quantity:'2.00',unit:'cu.m.',unitCost:'1800.00',amount:'3,600.00'},
 {name:'12mm Ø Reinforced Steel bar',quantity:'16.00',unit:'pcs.',unitCost:'145.00',amount:'2,320.00'},
 {name:'#16 G.I. Tie Wire',quantity:'10.00',unit:'kgs.',unitCost:'100.00',amount:'1,000.00'},
]}]}];
const save=(db,draft=concrete,project=1)=>db.query('select import_reviewed_estimate($1,$2::jsonb)',[project,JSON.stringify(draft)]);

test('Concrete Footings saves all five source BOM materials and their exact printed totals',async()=>{
 const db=await fixture();try{
  await save(db);
  const rows=(await db.query("select material_name,planned_quantity::text,unit_cost::text,amount::text from estimate_task_material_assignments where task_id=(select id from estimate_tasks where task_name='CONCRETE FOOTINGS') order by id")).rows;
  assert.equal(rows.length,5);assert.equal(rows[2].material_name,'" Gravel');assert.equal(rows[3].material_name,'12mm Ø Reinforced Steel bar');
  assert.equal(rows[0].amount,'6300.00');
  const task=(await db.query("select material_estimate::text,total_estimate_cost::text,planned_start_date::text,planned_end_date::text from estimate_tasks where task_name='CONCRETE FOOTINGS'")).rows[0];
  assert.equal(Number(task.material_estimate),14420);assert.equal(Number(task.total_estimate_cost),14420);
  assert.equal(task.planned_start_date,'2026-11-02');assert.equal(task.planned_end_date,'2026-11-02');
 }finally{await db.close();}
});

test('a late material failure rolls back the entire import and both history checkpoints',async()=>{
 const db=await fixture();try{
  const before=(await db.query('select gantt_snapshot(1) as snapshot')).rows[0].snapshot;
  const history=(await db.query('select count(*)::int as n from gantt_snapshots')).rows[0].n;
  await db.exec("alter table estimate_task_material_assignments add constraint fixture_rejection check(material_name<>'Screened sand')");
  await assert.rejects(save(db),/fixture_rejection/);
  assert.deepEqual((await db.query('select gantt_snapshot(1) as snapshot')).rows[0].snapshot,before);
  assert.equal((await db.query('select count(*)::int as n from gantt_snapshots')).rows[0].n,history);
 }finally{await db.close();}
});

test('mixed standalone costs preserve direct totals, missing values and printed amount overrides',async()=>{
 const db=await fixture();try{
  await save(db,[{name:'Setup',tasks:[],amount:'500',amountType:'other',laborEstimate:'1200',
   materials:[{name:'Plywood',quantity:'2',unitCost:'100',amount:'250'}],
   equipment:[{name:'Mixer rental',amount:'300'}],otherCosts:[{name:'Delivery',amount:'100'}]}]);
  const row=(await db.query("select category_material_estimate::float as material,category_labor_estimate::float as labor,category_equipment_estimate::float as equipment,category_other_estimate::float as other from estimate_categories where category_name='Setup'")).rows[0];
  assert.deepEqual(row,{material:250,labor:1200,equipment:300,other:600});
  assert.equal((await db.query("select count(*)::int as n from estimate_task_other_costs where category_id=(select id from estimate_categories where category_name='Setup')")).rows[0].n,2);
 }finally{await db.close();}
});

test('expired sessions, view-only projects, maintenance and invalid costs cannot create import rows',async()=>{
 const db=await fixture();try{
  await db.exec("set test.active='no'");await assert.rejects(save(db),/not permitted/);
  await db.exec("set test.active='yes'");await assert.rejects(save(db,concrete,2),/not permitted/);
  await db.exec("set test.maintenance='on'");await assert.rejects(save(db),/paused/);
  await db.exec("set test.maintenance='off'");
  const invalid=structuredClone(concrete);invalid[0].tasks[0].materials[4].quantity='-1';
  await assert.rejects(save(db,invalid),/nonnegative/);
  assert.equal((await db.query("select count(*)::int as n from estimate_tasks where task_name='CONCRETE FOOTINGS'")).rows[0].n,0);
 }finally{await db.close();}
});

test('one Undo removes the complete import and Redo restores every resource',async()=>{
 const db=await fixture();try{
  await save(db);
  const reopened=(await db.query("select gantt_history(1,'checkpoint') as state")).rows[0].state;
  assert.equal(reopened.canUndo,true);
  await db.exec("select gantt_history(1,'undo')");
  assert.equal((await db.query("select count(*)::int as n from estimate_categories where category_name='CONCRETE WORKS'")).rows[0].n,0);
  await db.exec("select gantt_history(1,'redo')");
  assert.equal((await db.query("select count(*)::int as n from estimate_task_material_assignments where task_id=(select id from estimate_tasks where task_name='CONCRETE FOOTINGS')")).rows[0].n,5);
 }finally{await db.close();}
});
