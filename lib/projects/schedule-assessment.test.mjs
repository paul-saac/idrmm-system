import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('./schedule-assessment.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const assess=exports.assessProjectSchedule;
const row=(id,props={})=>({id,name:`Task ${id}`,plannedStartDate:'2026-01-05',plannedEndDate:'2026-01-16',percentComplete:50,isMilestone:false,weight:100,tasks:[],...props});
const project={startDate:'2026-01-05',targetEndDate:'2026-01-30',actualEndDate:null,workingDays:[1,2,3,4,5],holidays:[]};
const fixture=(props={})=>({project:{...project},categories:[row(1)],taskRecords:{},categoryRecords:{1:{loggedDates:['2026-01-09']}},today:'2026-01-09',...props});

test('on-track work forecasts from saved progress without changing the baseline or actual progress',()=>{
  const input=fixture(),before=JSON.stringify(input),result=assess(input);
  assert.equal(result.risk,'low');assert.equal(result.forecastDate,'2026-01-16');assert.equal(result.differenceDays,-14);
  assert.equal(JSON.stringify(input),before);
});
test('a delayed task stays medium if buffer absorbs it, and becomes high when projection exceeds target',()=>{
  const input=fixture({categories:[row(1,{percentComplete:40})]});
  assert.equal(assess(input).risk,'medium');assert.equal(assess(input).forecastDate,'2026-01-21');
  input.project={...project,targetEndDate:'2026-01-16'};
  assert.equal(assess(input).risk,'high');assert.equal(assess(input).differenceDays,5);
});
test('successor windows absorb an upstream slip until delays snowball past the available buffer',()=>{
  const input=fixture({today:'2026-01-07',project:{...project,targetEndDate:'2026-01-16'},categories:[
    row(1,{plannedEndDate:'2026-01-08',percentComplete:50}),
    row(2,{plannedStartDate:'2026-01-14',plannedEndDate:'2026-01-16',percentComplete:0,predecessorCategoryId:1}),
  ],categoryRecords:{1:{loggedDates:['2026-01-07']}}});
  assert.equal(assess(input).forecastDate,'2026-01-16');assert.equal(assess(input).risk,'medium');
  input.categories[0].percentComplete=20;
  assert.equal(assess(input).forecastDate,'2026-01-28');assert.equal(assess(input).risk,'high');
  assert.equal(input.categories[1].plannedStartDate,'2026-01-14');
});
test('summary finish gates wait for every subtask and start gates do not add a phantom day',()=>{
  const input=fixture({today:'2026-01-05',categories:[row(1,{tasks:[row(11,{plannedEndDate:'2026-01-09',percentComplete:0})]}),
    row(2,{isMilestone:true,plannedEndDate:'2026-01-05',percentComplete:100})],categoryRecords:{2:{loggedDates:['2026-01-05']}}});
  assert.equal(assess(input).forecastDate,'2026-01-09');
  input.categories.push(row(3,{plannedStartDate:'2026-01-12',plannedEndDate:'2026-01-16',percentComplete:0,predecessorCategoryId:1}));
  assert.equal(assess(input).forecastDate,'2026-01-16');
});
test('working days, holidays and zero-duration milestones preserve date semantics',()=>{
  const input=fixture({project:{...project,holidays:['2026-01-12']}});
  assert.equal(assess(input).forecastDate,'2026-01-19');
  input.project.holidays=[];input.categories.push(row(2,{isMilestone:true,percentComplete:0,predecessorCategoryId:1}));
  assert.equal(assess(input).forecastDate,'2026-01-16');
});
test('no records, stale records, missing dates and future entries never produce reassuring ratings or made-up dates',()=>{
  for(const input of [fixture({categoryRecords:{}}),fixture({today:'2026-01-14'}),
    fixture({categories:[row(1,{plannedEndDate:null})]}),fixture({categoryRecords:{1:{loggedDates:['2026-01-12']}}}),
    fixture({project:{...project,workingDays:[]}})]){
    const result=assess(input);assert.equal(result.risk,'unassessed');assert.equal(result.forecastDate,null);
  }
});
test('missing dependencies, cycles, and child-to-containing-group dependencies are explicitly rejected',()=>{
  for(const categories of [[row(1,{predecessorCategoryId:99})],
    [row(1,{predecessorCategoryId:2}),row(2,{predecessorCategoryId:1})],
    [row(1,{tasks:[row(11,{predecessorCategoryId:1})]})]]){
    const result=assess(fixture({categories}));assert.equal(result.risk,'unassessed');assert.equal(result.forecastDate,null);
  }
});
test('zero progress is not automatic accomplishment; fresh zero logs use planned remaining durations',()=>{
  const input=fixture({categories:[row(1,{percentComplete:0})]});
  const result=assess(input);assert.equal(result.forecastDate,'2026-01-23');assert.equal(input.categories[0].percentComplete,0);
  assert.equal(assess(fixture({categories:[row(1,{percentComplete:0})],categoryRecords:{}})).forecastDate,null);
});
test('completed projects use recorded completion and a very slow pace fails safely',()=>{
  const complete=assess(fixture({categories:[row(1,{percentComplete:100})],project:{...project,actualEndDate:'2026-01-09'}}));
  assert.equal(complete.risk,'completed');assert.equal(complete.forecastDate,'2026-01-09');
  const slow=assess(fixture({categories:[row(1,{percentComplete:0.001})]}));
  assert.equal(slow.risk,'unassessed');assert.equal(slow.forecastDate,null);assert.match(slow.reason,/ten years/);
});
test('a large project assesses 1,000 subtasks without treating summary rows as extra work',t=>{
  const tasks=Array.from({length:1000},(_,i)=>row(i+1,{plannedEndDate:'2026-01-09',percentComplete:20}));
  const records=Object.fromEntries(tasks.map(task=>[task.id,{loggedDates:['2026-01-05']}]));
  const start=performance.now();const result=assess(fixture({today:'2026-01-05',categories:[row(1,{tasks})],taskRecords:records,categoryRecords:{}}));
  assert.equal(result.forecastDate,'2026-01-09');assert.equal(result.delayedTasks,0);
  t.diagnostic(`1,000-task calculation: ${Math.round(performance.now()-start)} ms on this test machine`);
});
