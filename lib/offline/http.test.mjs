import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function load(path,mocks={},env={NODE_ENV:'test'}){
 const exports={};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,require:name=>mocks[name]??{},console,process:{env},Request,Response,URL,TextDecoder,Date});return exports;
}
const validation=load('lib/offline/validate.ts');
const owner='00000000-0000-4000-8000-000000000001';
const input=()=>({quantityCompletedToday:20,costs:{labor:0,material:0,equipment:0,other:0},materialsUsed:[],attendance:[{workerId:5,hours:8}],equipmentCostsUsed:[],otherCostsUsed:[]});
const submission=()=>({id:crypto.randomUUID(),ownerId:owner,projectId:1,itemId:1,kind:'task',workDate:'2026-01-02',capturedAt:'2026-01-02T04:00:00Z',expectedVersion:null,input:input()});
const headers={'Content-Type':'application/json',Origin:'https://idrmm.online'};
const request=body=>new Request('https://idrmm.online/api/offline/sync',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});

test('offline input validation rejects invalid dates, nonfinite values and malformed resource rows',()=>{
 assert.equal(validation.validOfflineSubmission(submission()),true);
 for(const change of [s=>s.workDate='2026-02-30',s=>s.input.quantityCompletedToday=NaN,s=>s.ownerId='invalid',s=>s.expectedVersion='invalid',s=>s.input.costs.other=-1,s=>s.input.attendance[0].hours=25,s=>s.input.materialsUsed=[{name:'',quantity:2,unit:'bag'}],s=>s.input.unplannedMaterials=[{name:'Sand',quantity:1,unit:'bag',unitCost:-1}]]){
  const value=submission();change(value);assert.equal(validation.validOfflineSubmission(value),false);
 }
 const fixed=submission();fixed.input.attendance=[{workerId:6,hours:0,amount:1200}];assert.equal(validation.validOfflineSubmission(fixed),true);
 fixed.input.attendance[0].hours=8;assert.equal(validation.validOfflineSubmission(fixed),false);
});

test('synchronization requires session, original account and same-origin JSON, then distinguishes conflicts from outages',async()=>{
 let profile={id:owner},rpcError=null,calls=0,updates=0;
 const api=load('app/api/offline/sync/route.ts',{
  '@/lib/auth/session':{getSessionProfile:async()=>profile},
  '@/lib/supabase/server':{createClient:async()=>({rpc:async(_name,args)=>{calls++;assert.equal(args.p_work_date,'2026-01-02');return {data:{id:args.p_id},error:rpcError};}})},
  '@/lib/offline/http':{sameOfflineOrigin:r=>r.headers.get('origin')==='https://idrmm.online',offlineHeaders:{'Cache-Control':'private, no-store'}},
  '@/lib/offline/validate':validation,
  '@/lib/projects/sync':{syncProjectStatusFromProgress:async()=>{updates++;}},
  '@/lib/projects/revalidate':{revalidateProjectPaths(){},revalidateProjectLists(){}},
 });
 profile=null;assert.equal((await api.POST(request(submission()))).status,401);assert.equal(calls,0);
 profile={id:owner};const other=submission();other.ownerId='00000000-0000-4000-8000-000000000002';assert.equal((await api.POST(request(other))).status,403);assert.equal(calls,0);
 assert.equal((await api.POST(new Request('https://idrmm.online/api/offline/sync',{method:'POST',body:'{}'}))).status,403);
 assert.equal((await api.POST(request('{broken json'))).status,400);
 assert.equal((await api.POST(request(' '.repeat(1024*1024+1)))).status,413);
 for(const [code,status] of [['40001',409],['42501',403],['22023',422],['23514',422],['55000',503]]){
  rpcError={code,message:'Validation failed'};const response=await api.POST(request(submission()));assert.equal(response.status,status);assert.equal(updates,0);
 }
 rpcError=null;const success=await api.POST(request(submission()));assert.equal(success.status,200);assert.equal(updates,1);assert.equal(success.headers.get('cache-control'),'private, no-store');
});

test('offline project preparation rejects unauthorized users and only returns the necessary cached fields',async()=>{
 let permitted=false,reads=0;
 const api=load('app/api/offline/projects/[id]/route.ts',{
  '@/lib/auth/project-access':{requireProjectAccess:async()=>permitted?{id:owner,firstName:'Field',lastName:'Member',email:'private@example.test'}:null},
  '@/lib/supabase/server':{createClient:async()=>({rpc:async()=>({data:{},error:null})})},
  '@/lib/projects/data':{getProjectById:async()=>{reads++;return{id:1,name:'Test',archivedAt:null};}},
  '@/lib/cost-estimate/data':{getCostEstimate:async()=>({categories:[{id:1,name:'Standalone',tasks:[],estimatedQuantity:100,unit:'m',materialAssignments:[],plannedStartDate:null,plannedEndDate:null},{id:2,name:'Milestone',tasks:[],isMilestone:true,materialAssignments:[]}]})},
  '@/lib/workers/data':{listWorkers:async()=>[{id:5,fullName:'Worker',category:'skilled',employmentType:'employee',hourlyRate:100,contactNumber:'private-phone',profileId:'private-id'},{id:6,fullName:'Manager',category:'management',employmentType:'employee',hourlyRate:100}],listTaskWorkerAssignments:async()=>({}),listCategoryWorkerAssignments:async()=>({1:[5]})},
  '@/lib/offline/http':{offlineHeaders:{'Cache-Control':'private, no-store'}},
 });
 const url=new Request('https://idrmm.online/api/offline/projects/1');const context={params:Promise.resolve({id:'1'})};
 assert.equal((await api.GET(url,context)).status,403);assert.equal(reads,0);
 permitted=true;const response=await api.GET(url,context);assert.equal(response.status,200);const body=await response.json();assert.equal(body.items.length,1);assert.equal(body.items[0].key,'category-1');assert.equal(body.workers.length,1);assert.deepEqual(Object.keys(body.workers[0]).sort(),['id','name','rate','subcontractor']);assert.ok(!JSON.stringify(body).includes('private-'));
 assert.equal((await api.GET(new Request(url.url+'?workDate=2026-02-30'),context)).status,400);
});

test('production origin checks do not trust a forged host or missing Origin',()=>{
 const {sameOfflineOrigin}=load('lib/offline/http.ts',{}, {NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://idrmm.online'});
 const r=origin=>({headers:new Headers(origin?{Origin:origin}:{}),nextUrl:new URL('https://attacker.test')});
 assert.equal(sameOfflineOrigin(r('https://idrmm.online')),true);
 assert.equal(sameOfflineOrigin(r('https://attacker.test')),false);assert.equal(sameOfflineOrigin(r()),false);
});
