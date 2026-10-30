import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const root=process.cwd();
function load(relative,mocks={},globals={}) {
  const file=path.resolve(root,relative);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  const resolver=name=>{
    if(name in mocks) return mocks[name];
    if(name==='server-only') return {};
    if(name.startsWith('@/')) return load(`${name.slice(2)}.ts`,mocks,globals);
    if(name.startsWith('.')) return load(path.resolve(path.dirname(file),name)+'.ts',mocks,globals);
    return require(name);
  };
  runInNewContext(code,{exports,require:resolver,console,Date,Intl,AbortSignal,fetch,process:{env:{}},...globals});
  return exports;
}
const {buildInsightContext}=load('lib/project-insights/context.ts');
const now=new Date('2026-10-28T17:00:00Z'); // Oct 29 in Asia/Manila.
const costs=(labor=0,material=0,equipment=0,other=0)=>({labor,material,equipment,other});
const task=(id,extra={})=>({id,name:`Task ${id}`,plannedStartDate:'2026-10-01',plannedEndDate:'2026-10-10',percentComplete:0,weight:50,isMilestone:false,predecessorTaskId:null,...extra});
function fixture(extra={}) {
  return {
    project:{id:42,project_name:'Sample project',start_date:'2026-10-01',target_end_date:'2026-12-31',actual_end_date:null,allocated_budget:1000,archived_at:null,working_days:[1,2,3,4,5,6],holidays:[]},
    estimate:{categories:[{id:7,name:'Phase',tasks:[task(1),task(2)],percentComplete:100,weight:100}],lifecycle:{hasRecordedWork:false,allItemsComplete:false,itemCount:2},summary:{totalEstimatedCost:200,totalsByColumn:costs(50,100,40,10),costsToDate:costs()}},
    logs:[],workers:[],equipment:[],documents:[],...extra,
  };
}
const normalized=value=>JSON.parse(JSON.stringify(value));

test('AI context keeps date-based progress separate from saved actual work and uses Manila date',()=>{
  const context=buildInsightContext(fixture(),now);
  assert.equal(context.asOfDate,'2026-10-29');
  assert.equal(context.summary.costWeightedActualProgress,0);
  assert.equal(context.summary.savedActualTotal,0);
  assert.equal(context.project.status,'planning');
  assert.match(context.facts.find(f=>f.id==='behind:task-1').evidence,/actual progress is 0%.*comparison is 100%/);
  assert.ok(context.facts.some(f=>f.id==='missing-progress'));
});

test('schedule findings use the same five-point tolerance as the workspace',()=>{
  const source=fixture();for(const task of source.estimate.categories[0].tasks) task.percentComplete=97;
  assert.equal(buildInsightContext(source,now).facts.some(f=>f.id.startsWith('behind:')),false);
  source.estimate.categories[0].tasks[0].percentComplete=94;
  assert.equal(buildInsightContext(source,now).facts.some(f=>f.id==='behind:task-1'),true);
});

test('leaf progress excludes parent rollups, standalone phases count, and material costs are not doubled',()=>{
  const source=fixture();source.estimate.categories[0].tasks[0].percentComplete=20;source.estimate.categories[0].tasks[1].percentComplete=40;
  source.estimate.summary.costsToDate=costs(5,40,20,10);
  let context=buildInsightContext(source,now);
  assert.equal(context.summary.costWeightedActualProgress,30);
  assert.equal(context.summary.savedActualTotal,75);
  const standalone={...source.estimate.categories[0],tasks:[],percentComplete:25,plannedStartDate:'2026-10-01',plannedEndDate:'2026-11-01',isMilestone:false};
  source.estimate.categories=[standalone];context=buildInsightContext(source,now);
  assert.equal(context.summary.workItemCount,1);assert.equal(context.summary.costWeightedActualProgress,25);
});

test('budget and Planned cost facts use distinct totals and saved costs only',()=>{
  const source=fixture();source.project.allocated_budget=80;source.estimate.summary.costsToDate=costs(10,210,0,0);
  const context=buildInsightContext(source,now);
  assert.match(context.facts.find(f=>f.id==='allocated-budget').evidence,/220.00.*80.00.*140.00/);
  assert.match(context.facts.find(f=>f.id==='planned-total').evidence,/Planned cost of PHP 200.00/);
  assert.match(context.facts.find(f=>f.id==='cost:material').evidence,/priced material usage/);
});

test('resource overlap considers future working days and ignores completed tasks',()=>{
  const source=fixture();source.estimate.categories[0].tasks=[task(1,{plannedStartDate:'2026-11-01',plannedEndDate:'2026-11-01'}),task(2,{plannedStartDate:'2026-11-01',plannedEndDate:'2026-11-01'})];
  source.equipment=[{itemKey:'task-1',equipmentId:9,name:'Crane'},{itemKey:'task-2',equipmentId:9,name:'Crane'}];
  assert.equal(buildInsightContext(source,now).facts.some(f=>f.id.startsWith('equipment-overlap')),false); // Sunday.
  for(const item of source.estimate.categories[0].tasks) {item.plannedStartDate='2026-11-02';item.plannedEndDate='2026-11-03';}
  assert.equal(buildInsightContext(source,now).facts.some(f=>f.id.startsWith('equipment-overlap')),true);
  source.estimate.categories[0].tasks[0].percentComplete=100;
  assert.equal(buildInsightContext(source,now).facts.some(f=>f.id.startsWith('equipment-overlap')),false);
});

test('current document versions exclude superseded rejections and archived schedules do not produce current delays',()=>{
  const source=fixture({documents:[{id:1,sheet_number:'S-1',document_type:'drawing',revision:1,status:'rejected'},{id:2,sheet_number:'S-1',document_type:'drawing',revision:2,status:'accepted'},{id:3,sheet_number:'S-2',document_type:'drawing',revision:1,status:'submitted'}]});
  source.project.archived_at='2026-10-20T00:00:00Z';
  const context=buildInsightContext(source,now);
  assert.equal(context.summary.currentDocumentCount,2);
  assert.equal(context.facts.some(f=>f.id==='document-changes'),false);
  assert.ok(context.facts.some(f=>f.id==='document-review'));
  assert.equal(context.facts.some(f=>f.id.startsWith('behind:')),false);
});

test('zero-cost progress is unavailable rather than invented, and evidence is bounded',()=>{
  const source=fixture();source.estimate.summary.totalEstimatedCost=0;
  source.estimate.categories[0].tasks=Array.from({length:50},(_,i)=>task(i+1,{name:'x'.repeat(500)}));
  const context=buildInsightContext(source,now);
  assert.equal(context.summary.costWeightedActualProgress,null);
  assert.ok(context.facts.some(f=>f.id==='no-planned-cost'));
  assert.ok(context.facts.length<=25);assert.ok(JSON.stringify(context).length<22000);
});

const context=buildInsightContext(fixture(),now);
const payload={summary:'The saved records need review.',insights:[{factId:context.facts[0].id,recommendation:'Review the schedule and verify the latest accomplishment logs.'}]};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const completion=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});

test('AI output cannot invent evidence, navigation, facts or duplicate findings',()=>{
  const {parseInsightResponse}=load('lib/project-insights/provider.ts');
  const result=parseInsightResponse({...payload,insights:[{...payload.insights[0],destination:'https://untrusted.test',evidence:'Invented'}]},context);
  assert.equal(result.findings[0].evidence,context.facts[0].evidence);
  assert.equal(result.findings[0].destination,context.facts[0].destination);
  assert.equal(parseInsightResponse({...payload,insights:[{factId:'not-a-project-fact',recommendation:'Invented'}]},context),null);
  assert.equal(parseInsightResponse({...payload,insights:[payload.insights[0],payload.insights[0]]},context),null);
  assert.equal(parseInsightResponse([],context),null);
});

test('strict schema fallback still validates provider facts and keeps credentials out of the payload',async()=>{
  const requests=[];
  const {requestInsightAnalysis}=load('lib/project-insights/provider.ts',{}, {fetch:async(url,options)=>{
    assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
    requests.push(JSON.parse(options.body));assert.ok(!options.body.includes('private-key'));
    assert.equal(options.headers.Authorization,'Bearer private-key');
    return requests.length===1?response({error:{code:'json_validate_failed'}},400):response(completion(payload));
  }});
  const result=await requestInsightAnalysis(context,'private-key');
  assert.equal(result.findings.length,1);assert.equal(requests.length,2);
  assert.equal(requests[0].response_format.type,'json_schema');assert.equal(requests[1].response_format.type,'json_object');
});

test('provider rate limits, failed credentials, invalid output and timeouts return safe errors',async()=>{
  for(const [status,pattern] of [[429,/usage limit/],[401,/administrator/],[503,/temporarily unavailable/]]) {
    const provider=load('lib/project-insights/provider.ts',{}, {fetch:async()=>response({error:{message:'private provider diagnostic'}},status)});
    await assert.rejects(provider.requestInsightAnalysis(context,'key'),pattern);
  }
  const invalid=load('lib/project-insights/provider.ts',{}, {fetch:async()=>response(completion({...payload,insights:[{factId:'foreign-id',recommendation:'Wrong project'}]}))});
  await assert.rejects(invalid.requestInsightAnalysis(context,'key'),/could not be verified/);
  const timeout=load('lib/project-insights/provider.ts',{}, {fetch:async()=>{throw new Error('private socket address');}});
  await assert.rejects(timeout.requestInsightAnalysis(context,'key'),/could not connect/);
});

function actionSetup() {
  const state={authorized:true,actor:'user-a',context:normalized(context),loads:0,calls:0};
  const action=load('lib/project-insights/actions.ts',{
    '@/lib/auth/project-access':{requireProjectAccess:async(id,mode)=>{assert.equal(id,42);assert.equal(mode,'view');return state.authorized?{id:state.actor}:null;}},
    './data':{loadInsightContext:async()=>{state.loads++;return state.context;}},
    './provider':{requestInsightAnalysis:async()=>{state.calls++;return {summary:'Fixture summary',findings:[]};}},
  },{process:{env:{GROQ_API_KEY:'fixture-key'}}});
  return {state,generate:action.generateProjectInsights};
}

test('server actions authorize before data reads/provider calls and reject invalid IDs',async()=>{
  const {state,generate}=actionSetup();
  for(const id of [0,-1,NaN,1.5,'42']) assert.ok((await generate(id)).error);
  state.authorized=false;assert.match((await generate(42)).error,/do not have access/);
  assert.equal(state.loads,0);assert.equal(state.calls,0);
});

test('cache is permission-checked, scoped per user, invalidated by saved changes and avoids duplicate requests',async()=>{
  const {state,generate}=actionSetup();
  await Promise.all([generate(42),generate(42)]);assert.equal(state.calls,1);
  await generate(42);assert.equal(state.calls,1);assert.equal(state.loads,3);
  state.context.summary.savedActualTotal=300;await generate(42);assert.equal(state.calls,2);
  state.actor='user-b';await generate(42);assert.equal(state.calls,3);
  state.authorized=false;assert.ok((await generate(42)).error);assert.equal(state.calls,3);
});

test('empty projects do not consume AI requests',async()=>{
  const {state,generate}=actionSetup();state.context.summary.workItemCount=0;
  assert.equal((await generate(42)).empty,true);assert.equal(state.calls,0);
});

test('data loader scopes every query to the authorized project and excludes people/contact/file contents',async()=>{
  const source=fixture();const requests=[];
  const records={projects:source.project,task_progress_entries:[{task_id:1,entry_date:'2026-10-10'}],category_progress_entries:[],task_worker_assignments:[{task_id:1,worker_id:10},{task_id:2,worker_id:11}],category_worker_assignments:[],equipment_task_plans:[{item_key:'task-1',equipment_id:3}],project_sheets:[],workers:[{id:10,category:'management',employment_type:'employee'},{id:11,category:'skilled',employment_type:'employee'}],equipment:[{id:3,name:'Crane'}]};
  const client={from(table){const record={table,columns:null,filters:[]};requests.push(record);const query={select(columns){record.columns=columns;return query;},eq(field,value){record.filters.push([field,value]);return query;},in(field,value){record.filters.push([field,value]);return query;},async maybeSingle(){return {data:records[table],error:null};},then(resolve){return Promise.resolve({data:records[table],error:null}).then(resolve);}};return query;}};
  const loader=load('lib/project-insights/data.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/cost-estimate/data':{getCostEstimate:async(id,strict)=>{assert.equal(id,42);assert.equal(strict,true);return source.estimate;}}});
  await loader.loadInsightContext(42);
  for(const table of ['projects','equipment_task_plans','project_sheets']) assert.ok(requests.find(row=>row.table===table).filters.some(([field,value])=>['id','project_id'].includes(field)&&value===42));
  assert.deepEqual(requests.find(row=>row.table==='task_progress_entries').filters,[['task_id',[1,2]]]);
  assert.equal(requests.find(row=>row.table==='workers').columns,'id,category,employment_type');
  assert.ok(requests.every(row=>!(/contact|email|file_path|password|\*/.test(row.columns))));
});
