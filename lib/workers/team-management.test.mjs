import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function compile(file,mocks={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,FormData,require:name=>mocks[name],console:{error(){}}});return exports;}
const presets=compile('./presets.ts');
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
