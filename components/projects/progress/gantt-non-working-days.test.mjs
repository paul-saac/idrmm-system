import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('./gantt-non-working-days.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const slices=exports.nonWorkingDaySlices;
const date=iso=>new Date(`${iso}T00:00:00`);
const event=(date,name,isWorkingDay=false)=>({date,name,isWorkingDay,type:'holiday'});

test('project weekdays and excluded holiday dates alone determine shading',()=>{
 const dates=['2026-11-28','2026-11-29','2026-11-30','2026-12-01'].map(date),before=dates.map(d=>d.getTime());
 const result=slices(dates,60,'Day',[1,2,3,4,5,6],['2026-11-30'],[event('2026-11-30','Bonifacio Day')]);
 assert.equal(result.length,2);assert.equal(result[0].date,'2026-11-29');assert.equal(result[0].x,60);assert.equal(result[0].width,60);
 assert.match(result[0].title,/Sunday.*Non-working day/);assert.equal(result[1].holiday,true);assert.equal(result[1].x,120);
 assert.match(result[1].title,/Bonifacio Day.*Non-working holiday/);assert.deepEqual(dates.map(d=>d.getTime()),before);
});
test('working holiday toggles and working Sundays update shading immediately',()=>{
 const dates=['2026-12-08','2026-12-09'].map(date);
 assert.equal(slices(dates,60,'Day',[1,2,3,4,5,6],[],[event('2026-12-08','Holiday',true)]).length,0);
 assert.equal(slices(dates,60,'Day',[1,2,3,4,5,6],['2026-12-08'],[event('2026-12-08','Holiday')]).length,1);
 assert.equal(slices([date('2026-11-29')],60,'Day',[1,2,3,4,5,6,7],[],[]).length,0);
});
test('month and year zoom shade individual dates proportionately, including the final column',()=>{
 const month=slices([date('2026-11-01')],300,'Month',[1,2,3,4,5,6],['2026-11-30'],[]);
 assert.equal(month.find(d=>d.date==='2026-11-30').x,290);assert.equal(month.find(d=>d.date==='2026-11-30').width,10);
 const year=slices([date('2026-01-01')],365,'Year',[1,2,3,4,5,6,7],['2026-12-31'],[]);
 assert.equal(year.length,1);assert.equal(year[0].x,364);assert.equal(year[0].width,1);
});


test('non-working shading stays below date headers and is rendered only in Day view',()=>{
 const layer={};runInNewContext(ts.transpileModule(readFileSync(new URL('./gantt-non-working-layer.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports:layer,require:name=>name==='react'?{useMemo:fn=>fn()}:name==='./gantt-non-working-days'?exports:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
 });
 const props={dates:[date('2026-11-29')],columnWidth:60,height:34,header:false,viewMode:'Day',workingDays:[1,2,3,4,5,6],holidays:[],events:[]};
 const body=layer.GanttNonWorkingLayer(props),header=layer.GanttNonWorkingLayer({...props,header:true,height:50});
 assert.equal(body.props.children[0].props.children[0].props.fill,'rgba(113,113,122,0.08)');
 assert.equal(header.props.children[0].props.children[0].props.fill,'transparent');
 for(const viewMode of ['Month','Year','Week'])assert.equal(layer.GanttNonWorkingLayer({...props,viewMode}),null);
});
