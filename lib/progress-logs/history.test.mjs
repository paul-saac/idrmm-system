import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';

const row=(id,date,created,action='saved')=>({id,project_id:1,task_id:2,category_id:null,entry_date:date,created_at:created,action,
  saved_by:null,saved_by_name:'Site recorder',quantity_completed:1,labor_cost:100,material_cost:0,equipment_cost:0,other_cost:0,materials_used:[],attendance:[]});
function actions(rows){
  const exports={};
  const client={from(){
    let result=[...rows];const orders=[];
    return {
      select(){return this;},
      eq(key,value){result=result.filter(r=>r[key]===value);return this;},
      order(key,{ascending}){orders.push([key,ascending]);return this;},
      then(resolve){
        result.sort((a,b)=>{for(const[key,ascending]of orders){if(a[key]===b[key])continue;return(a[key]<b[key]?-1:1)*(ascending?1:-1);}return 0;});
        return Promise.resolve({data:result,error:null}).then(resolve);
      },
    };
  }};
  runInNewContext(ts.transpileModule(readFileSync(new URL('./actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,require:name=>({
    '@/lib/supabase/server':{createClient:async()=>client},'@/lib/auth/project-access':{requireProjectAccess:async()=>({id:'tester'})},'@/lib/auth/roles':{roleLabel:v=>v},
  }[name])});return exports;
}
test('both history readers sort by log day, then revision time, without backdating imports',async()=>{
  const imported='2026-10-31T12:00:00Z',service=actions([row(3,'2026-10-27',imported),row(2,'2026-10-30',imported),row(1,'2026-10-28',imported)]);
  const item=await service.listOverrideLogs(1,{kind:'task',id:2}),project=await service.listProjectOverrideHistory(1);
  for(const logs of[item,project['task-2']]){assert.deepEqual(Array.from(logs,l=>l.entryDate),['2026-10-30','2026-10-28','2026-10-27']);assert.ok(logs.every(l=>l.createdAt===imported));}
});
test('a deletion still hides earlier saves only for the matching day; later corrections remain visible',async()=>{
  const service=actions([row(1,'2026-10-27','2026-10-31T08:00:00Z'),row(2,'2026-10-27','2026-10-31T09:00:00Z','deleted'),row(3,'2026-10-27','2026-10-31T10:00:00Z'),row(4,'2026-10-28','2026-10-31T07:00:00Z')]);
  assert.deepEqual(Array.from(await service.listOverrideLogs(1,{kind:'task',id:2}),l=>l.id),[4,3]);
});
test('the actual history card displays entry dates and retains upload timestamps in its tooltip',()=>{
  const source=ts.createSourceFile('progress.tsx',readFileSync(new URL('../../components/projects/progress/progress-tracking-modal-content.tsx',import.meta.url),'utf8'),99,true,4);
  const names=new Set(['OverrideHistory','formatDay','formatDateTime']);const functions=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(source)).join('\n');
  const context={exports:{},...React,Date,console,HISTORY_PREVIEW:5,HISTORY_COST_ORDER:[],HISTORY_COST_LABEL:{},EMPTY_INCIDENTS:[],formatQuantity:String,formatPeso:String,
    HistoryHeading:()=>null,SavedProgressLogModal:()=>null,InitialsAvatar:()=>null,ChevronRight:()=>null,Trash2:()=>null,require:name=>name==='react/jsx-runtime'?jsx:null};
  runInNewContext(ts.transpileModule(functions+'\nexports.History=OverrideHistory;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
  const record={id:1,action:'saved',entryDate:'2026-10-27',createdAt:'2026-10-31T12:00:00Z',savedByName:'Site recorder',quantityCompleted:1,costs:{labor:100,material:0,equipment:0,other:0}};
  const html=renderToStaticMarkup(React.createElement(context.exports.History,{logs:[record],loggedDates:['2026-10-27'],unit:'sq.m',highlightLatest:false,projectName:'Fixture',currentIncidents:[]}));
  assert.match(html,/for Oct 27, 2026/);assert.match(html,/title="Saved to the system Oct 31, 2026/);
});
