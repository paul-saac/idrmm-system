import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
function fixture(){
 const state={profile:{role:'admin'},rpc:[],revalidated:0,error:null,access:[]};
 const mocks={
  '@/lib/auth/project-access':{requireProjectAccess:async(id,mode)=>{state.access.push({id,mode});return state.profile;}},
  '@/lib/auth/roles':{isAdminRole:role=>['admin','super_admin'].includes(role)},
  '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{state.rpc.push({name,args});return{error:state.error};}})},
  '@/lib/projects/sync':{syncProjectStatusFromProgress:async()=>{}},
  '@/lib/projects/revalidate':{revalidateProjectLists(){state.revalidated++;},revalidateProjectPaths(){}},
 };
 const exports={};runInNewContext(ts.transpileModule(readFileSync('lib/progress-logs/edit-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>mocks[name],console:{error(){}}});
 return{state,save:exports.editProgressLog};
}
test('history corrections require project edit access before calling the database',async()=>{
 const f=fixture();f.state.profile=null;
 assert.match((await f.save(1,'task',2,3,{})).error,/permission to edit/);
 assert.equal(f.state.access[0].mode,'edit');
 f.state.profile={role:'admin'};assert.ok((await f.save(1,'task',2,-1,{})).error);assert.equal(f.state.rpc.length,0);
});

test('Project Managers, Foremen, Administrators and Super Administrators may correct logs with project edit access',async()=>{
 for(const role of ['project_manager','foreman','admin','super_admin']){
  const f=fixture();f.state.profile={role};assert.equal((await f.save(1,'task',2,3,{})).success,true);assert.equal(f.state.rpc.length,1);
 }
});
test('correction passes the selected audit version to one transactional save and surfaces conflicts without revalidating',async()=>{
 const f=fixture(),input={quantityCompletedToday:25};
 assert.equal((await f.save(1,'category',2,3,input)).success,true);
 assert.equal(f.state.rpc.length,1);assert.equal(f.state.rpc[0].name,'edit_saved_progress_log');
 assert.equal(f.state.rpc[0].args.p_log_id,3);assert.equal(f.state.rpc[0].args.p_item_id,2);assert.equal(f.state.rpc[0].args.p_input,input);
 f.state.error={code:'40001',message:'This log has changed. Reopen its latest version before editing.'};
 assert.match((await f.save(1,'category',2,3,input)).error,/latest version/);assert.equal(f.state.revalidated,1);
});
