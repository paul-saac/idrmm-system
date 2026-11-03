import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{createRequire}from'node:module';import{runInNewContext}from'node:vm';
const require=createRequire(import.meta.url),{PGlite}=require('@electric-sql/pglite');
const baseURL=new URL('./nesting.test.mjs',import.meta.url);
const fixtureSource=readFileSync(baseURL,'utf8').match(/async function fixture\(\) \{[\s\S]*?\n\}/)[0].replaceAll('import.meta.url',JSON.stringify(baseURL.href));
const binding={};runInNewContext(fixtureSource+';exports.fixture=fixture;',{exports:binding,PGlite,readFileSync,URL});
async function fixture(before){
 const db=await binding.fixture();try{
 await db.exec("create table profiles(id uuid primary key);insert into profiles values('00000000-0000-0000-0000-000000000001');update estimate_categories set predecessor_task_id=null where id=3;insert into estimate_categories(project_id,category_name)values(1,'Finish'),(1,'Inspect');");
 if(before)await before(db);
 await db.exec(readFileSync(new URL('../../supabase/migrations/0123_multiple_task_dependencies.sql',import.meta.url),'utf8'));
 return db;
 }catch(e){await db.close();throw e;}
}
const save=(db,kind,id,incoming=[],outgoing=[],previousIn=null,previousOut=null)=>db.query('select save_estimate_dependencies(1,$1,$2,$3::text[],$4::text[],$5::text[],$6::text[])',[kind,id,incoming,outgoing,previousIn,previousOut]);
const links=async db=>(await db.query('select predecessor_key,successor_key from estimate_dependencies order by predecessor_key,successor_key')).rows;
test('atomic many-to-many save preserves other links, permits clearing and rejects stale forms',async()=>{
 const db=await fixture();try{
 await save(db,'task',1,['category:3','task:2'],['category:5','category:6']);assert.equal((await links(db)).length,4);
 await save(db,'category',5,['task:1','task:2']);assert.equal((await links(db)).length,5);
 await assert.rejects(save(db,'task',1,[],[],[],[]),/changed while/);assert.equal((await links(db)).length,5);
 await save(db,'task',1,['category:3'],['category:5']);assert.equal((await links(db)).length,3);
 await save(db,'task',1,[],[]);assert.deepEqual(await links(db),[{predecessor_key:'task:2',successor_key:'category:5'}]);
 }finally{await db.close();}
});
test('database rejects direct, indirect and grouped cycles, foreign-project nodes and grouped successors atomically',async()=>{
 const db=await fixture();try{
 await assert.rejects(save(db,'task',1,['task:1']),/itself/);
 await assert.rejects(save(db,'task',1,['category:1']),/circular/);
 await assert.rejects(save(db,'category',1,['task:1']),/circular/);
 await assert.rejects(save(db,'task',1,[],['category:2']),/grouped main/);
 await assert.rejects(save(db,'task',1,['category:4']),/same project/);
 await save(db,'task',1,[],['task:2']);await assert.rejects(save(db,'task',2,['task:1'],['task:1']),/circular/);assert.equal((await links(db)).length,1);
 await db.exec("set test.active='no'");await assert.rejects(save(db,'task',1),/not permitted/);
 await db.exec("set test.active='yes';set test.maintenance='on'");await assert.rejects(save(db,'task',1),/paused/);
 }finally{await db.close();}
});
test('Undo/Redo restores every link and preserves milestones and planned data',async()=>{
 const db=await fixture();try{
 await db.exec("select gantt_history(1,'reset')");
 await save(db,'task',1,['category:3','task:2'],['category:5','category:6']);const after=await links(db);
 await db.exec("select gantt_history(1,'checkpoint');select gantt_history(1,'undo')");assert.equal((await links(db)).length,0);
 await db.exec("select gantt_history(1,'redo')");assert.deepEqual(await links(db),after);
 }finally{await db.close();}
});
test('indent and outdent rewire multiple incoming/outgoing links; Undo/Redo retains all relationships',async()=>{
 const db=await fixture();try{
 await save(db,'category',3,['category:5','category:6'],['task:2']);
 await db.exec("select gantt_history(1,'reset')");
 const task=(await db.query("select nest_estimate_row(1,'category',3,1,null) value")).rows[0].value.task_id;
 assert.equal((await db.query('select count(*)::int n from estimate_dependencies where successor_task_id=$1 or predecessor_task_id=$1',[task])).rows[0].n,3);
 await db.exec("select gantt_history(1,'checkpoint');select gantt_history(1,'undo');select gantt_history(1,'redo')");
 const category=(await db.query('select outdent_estimate_row(1,$1,1,false) value',[task])).rows[0].value.category_id;
 assert.equal((await db.query('select count(*)::int n from estimate_dependencies where successor_category_id=$1 or predecessor_category_id=$1',[category])).rows[0].n,3);
 }finally{await db.close();}
});
test('migration preserves pre-existing links and older history snapshots',async()=>{
 const db=await fixture(async db=>{await db.exec("update estimate_tasks set predecessor_task_id=1 where id=2;select gantt_history(1,'reset');update estimate_tasks set predecessor_task_id=null where id=2;select gantt_history(1,'checkpoint')");});try{
 assert.equal((await links(db)).length,0);await db.exec("select gantt_history(1,'undo')");assert.deepEqual(await links(db),[{predecessor_key:'task:1',successor_key:'task:2'}]);
 await db.exec("select gantt_history(1,'redo')");assert.equal((await links(db)).length,0);
 }finally{await db.close();}
});


test('successor checklist edits only subtasks and preserves category links configured through predecessors',async()=>{
 const db=await fixture();try{
 await save(db,'category',5,['task:1']);
 await db.exec(readFileSync(new URL('../../supabase/migrations/0124_dependency_successor_subtasks.sql',import.meta.url),'utf8'));
 await save(db,'task',1,['category:3'],['task:2'],[],[]);
 assert.equal((await links(db)).length,3);
 await assert.rejects(save(db,'task',1,[],['category:6']),/subtasks as successors/);
 await save(db,'task',1,[],[],['category:3'],['task:2']);
 assert.deepEqual(await links(db),[{predecessor_key:'task:1',successor_key:'category:5'}]);
 await save(db,'category',5,['category:1','category:3','task:1','task:2']);
 assert.equal((await links(db)).length,4);
 }finally{await db.close();}
});
