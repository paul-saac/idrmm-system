import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function compile(path, mocks={}) {
  const exports={};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,require:name=>mocks[name]});
  return exports;
}
const {createScheduleMoveQueue}=compile('./schedule-move-queue.ts');
const dates=compile('../../../lib/cost-estimate/schedule-dates.ts');
const {selectedBarChanges}=compile('./gantt-bar-selection.ts',{'@/lib/cost-estimate/schedule-dates':dates});
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const move=(day,previous=20)=>({kind:'task',id:1,start:`2026-03-${day}`,end:`2026-03-${day+3}`,previousStart:`2026-03-${previous}`,previousEnd:`2026-03-${previous+3}`});
function fixture(){
  const calls=[],completions=[],state={busy:[],rollbacks:[],refreshes:0};
  const queue=createScheduleMoveQueue(changes=>{calls.push(plain(changes));return new Promise((resolve,reject)=>completions.push({resolve,reject}));});
  const callbacks={onBusy:value=>state.busy.push(value),onRollback:(positions,error)=>state.rollbacks.push({positions:plain(positions),error}),onIdle:()=>state.refreshes++};
  return {queue,calls,completions,state,enqueue:changes=>queue.enqueue(changes,callbacks)};
}

test('rapid drops enqueue immediately, save serially and refresh once after the batch',async()=>{
  const f=fixture();
  const first=f.enqueue([move(22)]),second=f.enqueue([move(24,22)]);
  assert.deepEqual(f.state.busy,[true]);assert.equal(f.calls.length,0);
  await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0].start,'2026-03-22');
  f.completions[0].resolve({success:true});await first;await tick();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1][0].previousStart,'2026-03-22');
  assert.equal(f.state.refreshes,0);assert.deepEqual(f.state.busy,[true]);
  f.completions[1].resolve({success:true});await second;
  assert.deepEqual(f.state.busy,[true,false]);assert.equal(f.state.refreshes,1);assert.equal(f.state.rollbacks.length,0);
});

test('a failed save cancels dependent queued drops, restores their baseline and permits a new drag',async()=>{
  const f=fixture();const first=f.enqueue([move(22)]),second=f.enqueue([move(24,22)]);
  await tick();f.completions[0].resolve({error:'Permission removed.'});await Promise.all([first,second]);
  assert.equal(f.calls.length,1);assert.equal(f.state.rollbacks[0].positions[0].start,'2026-03-20');
  assert.equal(f.state.rollbacks[0].error,'Permission removed.');assert.equal(f.state.refreshes,1);
  const third=f.enqueue([move(21)]);await tick();assert.equal(f.calls.length,2);
  f.completions[1].resolve({success:true});await third;
  assert.equal(f.state.refreshes,2);assert.deepEqual(f.state.busy,[true,false,true,false]);
});

test('rollback preserves an earlier confirmed move and separates task/category IDs',async()=>{
  const f=fixture();
  const first=f.enqueue([move(22)]);
  const second=f.enqueue([move(24,22),{...move(25),kind:'category',previousStart:null,previousEnd:null}]);
  const third=f.enqueue([move(26,24)]);
  await tick();f.completions[0].resolve({success:true});await first;await tick();
  f.completions[1].reject(Error('Connection interrupted.'));await Promise.all([second,third]);
  assert.equal(f.calls.length,2);
  assert.deepEqual(f.state.rollbacks[0].positions,[
    {kind:'task',id:1,start:'2026-03-22',end:'2026-03-25'},
    {kind:'category',id:1,start:null,end:null},
  ]);
  assert.equal(f.state.refreshes,1);assert.equal(f.state.busy.at(-1),false);
});

test('the next drop uses optimistic dates as the RPC concurrency baseline',()=>{
  const categories=[{id:2,tasks:[{id:1,plannedStartDate:'2026-03-20',plannedEndDate:'2026-03-23'}]}];
  const rows=[{id:'1',type:'task',start:new Date(2026,2,22),end:new Date(2026,2,26)}];
  const previous=new Map([['1',{start:'2026-03-22',end:'2026-03-25'}]]);
  const [change]=selectedBarChanges(new Set(['1']),rows,categories,2,previous);
  assert.equal(change.start,'2026-03-24');assert.equal(change.end,'2026-03-27');
  assert.equal(change.previousStart,'2026-03-22');assert.equal(change.previousEnd,'2026-03-25');
});

test('a large group indexes source records once instead of scanning all tasks for each selected bar',()=>{
  let sourceReads=0;
  const tasks=Array.from({length:1000},(_,index)=>({id:index+1,plannedStartDate:'2026-03-20',plannedEndDate:'2026-03-23'}));
  const categories=[{id:2,get tasks(){sourceReads++;return tasks;}}];
  const rows=tasks.map(task=>({id:String(task.id),type:'task',start:new Date(2026,2,20),end:new Date(2026,2,24)}));
  const changes=selectedBarChanges(new Set(rows.map(row=>row.id)),rows,categories,1);
  assert.equal(changes.length,1000);assert.ok(sourceReads<=2,`Source task list read ${sourceReads} times`);
});
