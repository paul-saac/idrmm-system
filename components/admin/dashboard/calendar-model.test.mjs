import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function compile(file,mocks={}) {
  const exports={};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports,require:name=>mocks[name]??{},Intl,Date,window:{setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}}});
  return exports;
}
const model=compile('./calendar-model.ts');

test('today uses Philippine midnight rather than the browser or hosting timezone',()=>{
  assert.equal(model.manilaToday(new Date('2026-10-31T15:59:59Z')),'2026-10-31');
  assert.equal(model.manilaToday(new Date('2026-10-31T16:00:00Z')),'2026-11-01');
  assert.equal(model.manilaToday(new Date('2026-12-31T16:00:00Z')),'2027-01-01');
});
test('calendar includes all dates in six complete Sunday-first weeks, including leap February',()=>{
  for(const [year,month]of [[2026,9],[2024,1],[2027,0],[2026,11]]){
    const days=model.calendarMonth(year,month);
    assert.equal(days.length,42);assert.equal(new Set(days.map(d=>d.iso)).size,42);
    assert.equal(new Date(days[0].iso+'T00:00:00Z').getUTCDay(),0);
    assert.equal(days.filter(d=>d.inMonth).length,new Date(Date.UTC(year,month+1,0)).getUTCDate());
  }
  assert.ok(model.calendarMonth(2024,1).some(d=>d.iso==='2024-02-29'&&d.inMonth));
});
function nodes(tree,predicate){if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(n=>nodes(n,predicate));return[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
test('calendar opens on the server-supplied date, browses months and returns to current today',()=>{
  const slots=[];let cursor=0;
  const react={useEffect(){},useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],next=>slots[index]=typeof next==='function'?next(slots[index]):next];}};
  const jsx=(type,props)=>({type,props});let now='2026-10-31';
  const {DashboardCalendar}=compile('./dashboard-calendar.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx},'./calendar-model':{...model,manilaToday:()=>now}});
  const render=()=>{cursor=0;return DashboardCalendar({initialToday:'2026-10-31'});};
  let tree=render();
  assert.equal(nodes(tree,n=>n.props?.['aria-current']==='date')[0].props.dateTime,'2026-10-31');
  nodes(tree,n=>n.props?.['aria-label']==='Next month')[0].props.onClick();tree=render();
  assert.equal(nodes(tree,n=>n.type==='table')[0].props['aria-label'],'November 2026');
  for(let i=0;i<2;i++){nodes(tree,n=>n.props?.['aria-label']==='Next month')[0].props.onClick();tree=render();}
  assert.equal(nodes(tree,n=>n.type==='table')[0].props['aria-label'],'January 2027');
  nodes(tree,n=>n.props?.['aria-label']==='Previous month')[0].props.onClick();tree=render();
  assert.equal(nodes(tree,n=>n.type==='table')[0].props['aria-label'],'December 2026');
  now='2026-11-01';nodes(tree,n=>n.type==='button'&&n.props.children==='Today')[0].props.onClick();tree=render();
  assert.equal(nodes(tree,n=>n.type==='table')[0].props['aria-label'],'November 2026');
  assert.equal(nodes(tree,n=>n.props?.['aria-current']==='date')[0].props.dateTime,'2026-11-01');
});
