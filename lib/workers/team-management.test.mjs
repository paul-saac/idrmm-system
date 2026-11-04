import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function compile(file,mocks={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,FormData,require:name=>mocks[name],console:{error(){}}});return exports;}
const presets=compile('./presets.ts');

test('the current Management roster contains only active accepted official accounts and uses their current names and roles',async()=>{
 const workers=[
  {id:1,full_name:'Old Name',trade:'Mason',category:'skilled',profile_id:'official'},
  {id:2,full_name:'Deleted Foreman',trade:'Foreman',category:'management',profile_id:null},
  {id:3,full_name:'Actual Mason',trade:'Mason',category:'management',profile_id:null},
  {id:4,full_name:'Missing Account',trade:'Foreman',category:'management',profile_id:'missing'},
  {id:5,full_name:'Inactive',trade:'Project Manager',category:'management',profile_id:'inactive'},
  {id:6,full_name:'Invited',trade:'Foreman',category:'management',profile_id:'invited'},
  {id:7,full_name:'Administrator',trade:'Foreman',category:'management',profile_id:'admin'},
 ];
 let profiles=[
  {id:'official',first_name:'Official',last_name:'Foreman',role:'foreman',status:'active',invitation_pending:false},
  {id:'inactive',role:'project_manager',status:'inactive',invitation_pending:false},
  {id:'invited',role:'foreman',status:'active',invitation_pending:true},
  {id:'admin',role:'admin',status:'active',invitation_pending:false},
 ];
 const client={from(table){let rows=table==='workers'?workers:profiles;return{
  select(){return this;},order(){return this;},in(key,values){rows=rows.filter(row=>values.includes(row[key]));return this;},
  eq(key,value){rows=rows.filter(row=>row[key]===value);return this;},
  then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);},
 };}};
 const data=compile('./data.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/task-progress/calculate':{},'@/lib/workers/presets':presets,'@/lib/workers/schedule':{DEFAULT_WORK_HOURS:[8,8,8,8,8,0,0]}});
 let roster=await data.listWorkers();
 assert.equal(roster.length,2);assert.equal(roster.find(row=>row.id===1).fullName,'Official Foreman');
 assert.equal(roster.find(row=>row.id===1).title,'Foreman');assert.equal(roster.find(row=>row.id===1).category,'management');
 assert.equal(roster.find(row=>row.id===3).category,'skilled');
 profiles=[];roster=await data.listWorkers();assert.equal(roster.length,1);assert.equal(roster[0].id,3);
 assert.equal(workers.length,7); // Historical worker records are never deleted.
});
test('known trades use canonical categories while linked management stays management',()=>{
  assert.equal(presets.memberCategory('Mason','management',null),'skilled');
  assert.equal(presets.memberCategory('Civil Engineer','skilled',null),'professional');
  assert.equal(presets.memberCategory('Mason','skilled','account'),'management');
  assert.equal(presets.isManagementMember({category:'management',profileId:null}),true);
});
test('Team actions reject management edits/deletes, retain worker editing and classify submitted trades',async()=>{
  let existing={category:'management',profile_id:'account'},writeCount=0,inserted,allowed=true;
  const client={from(){return {select(){return this;},eq(){return this;},in(){return this;},maybeSingle:async()=>({data:existing,error:null}),
    then(resolve){return Promise.resolve({data:[existing],error:null}).then(resolve);},
    update(){writeCount++;return this;},delete(){writeCount++;return this;},insert(fields){inserted=fields;writeCount++;return Promise.resolve({error:null});}};}};
  const actions=compile('./actions.ts',{'next/cache':{revalidatePath(){}},'@/lib/projects/revalidate':{},'@/lib/supabase/server':{createClient:async()=>client},'@/lib/auth/project-access':{},'@/lib/auth/session':{getSessionProfile:async()=>allowed?{id:'admin',role:'admin'}:null},'@/lib/workers/presets':presets,'@/lib/auth/roles':{isAdminRole:role=>role==='admin'},'@/lib/workers/data':{}});
  const form=new FormData();for(const [key,value] of Object.entries({firstName:'Test',lastName:'Worker',title:'Mason',category:'management'}))form.set(key,value);
  assert.match((await actions.updateWorker(1,{},form)).error,/read-only/);
  assert.match((await actions.deleteWorkers([1])).error,/Accounts/);assert.equal(writeCount,0);
  existing={category:'skilled',profile_id:null};
  assert.equal((await actions.createWorker({},form)).success,true);assert.equal(inserted.category,'skilled');
  assert.equal((await actions.updateWorker(1,{},form)).success,true);
  form.set('title','Foreman');assert.match((await actions.createWorker({},form)).error,/Accounts/);
  form.set('title','Mason');form.set('profileId','account');assert.match((await actions.createWorker({},form)).error,/Accounts/);
  allowed=false;assert.match((await actions.updateWorker(1,{},form)).error,/not authorized/);
});
