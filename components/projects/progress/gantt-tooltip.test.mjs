import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const source=readFileSync(new URL('./gantt-chart-view.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('gantt.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['GanttTooltipContent','trueEndDate','previousDay','toDate','formatPercent'];
const functions=[];for(const node of ast.statements)if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))functions.push(node.getText(ast));
const code=ts.transpileModule(functions.join('\n')+';exports.render=GanttTooltipContent;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(id,forecasts,reason='Save a progress log.',type='task'){
 const exports={},calendar={},assessment={};
 runInNewContext(code,{exports,Date,MILESTONE_LABEL_SEPARATOR:' ? ',WorkScheduleContext:calendar,TaskForecastContext:assessment,
  useContext:key=>key===calendar?{workingDays:[1,2,3,4,5,6],holidays:new Set()}:{taskForecasts:forecasts,reason},
  countWorkingDays:()=>3,require:()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'}),
 });
 return exports.render({task:{id,name:type==='milestone'?'Phase Done ? Nov 3':'Site Clearing',type,start:new Date(2026,10,1),end:new Date(2026,10,type==='milestone'?3:4),progress:35.2},fontSize:'12px',fontFamily:'sans-serif'});
}
const text=tree=>tree==null?'':typeof tree==='object'?Array.isArray(tree)?tree.map(text).join(''):text(tree.props?.children):String(tree);
test('hover displays inclusive planned completion and the exact task forecast with calendar-day delay',()=>{
 const value=text(render('11',{'task:11':{forecastDate:'2026-11-07',differenceDays:4}}));
 assert.match(value,/Planned Completion:Nov 3, 2026/);
 assert.match(value,/Planned Start:Nov 1, 2026Planned Completion:/);
 assert.match(value,/Forecasted Completion:Nov 7, 2026 \(4 days behind\)/);
 assert.match(value,/Progress: 35.20%/);
});
test('main task and milestone keys use category forecasts; early and on-time labels stay accurate',()=>{
 assert.match(text(render('phase-4',{'category:4':{forecastDate:'2026-11-02',differenceDays:-1}})),/1 day ahead/);
 const value=text(render('phase-5',{'category:5':{forecastDate:'2026-11-03',differenceDays:0}},'', 'milestone'));
 assert.match(value,/Planned Completion:Nov 3, 2026/);assert.match(value,/on schedule/);assert.doesNotMatch(value,/Duration:/);
});
test('missing or stale forecasts show no invented completion date',()=>{
 const value=text(render('11',{}));assert.match(value,/Forecasted Completion:Not available/);
 assert.doesNotMatch(value,/days behind|days ahead/);
});


test('forecasted start appears immediately above completion for unstarted tasks',()=>{
 const value=text(render('11',{'task:11':{forecastStartDate:'2026-11-05',firstRecordedDate:null,forecastDate:'2026-11-07',differenceDays:4}}));
 assert.match(value,/Forecasted Start:Nov 5, 2026Forecasted Completion:Nov 7, 2026/);
 assert.doesNotMatch(value,/First Recorded Work Date:/);
});

test('started tasks show their first recorded work date instead of a future start',()=>{
 const value=text(render('11',{'task:11':{forecastStartDate:null,firstRecordedDate:'2026-11-02',forecastDate:'2026-11-04',differenceDays:1}}));
 assert.match(value,/First Recorded Work Date:Nov 2, 2026Forecasted Completion:Nov 4, 2026/);
 assert.doesNotMatch(value,/Forecasted Start:/);
});
