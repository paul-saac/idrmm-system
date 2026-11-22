import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
function fixture(records){
 const state=[];let cursor=0;const react={createContext:()=>({Provider:'Provider'}),useCallback:fn=>fn,useMemo:fn=>fn(),useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];}};
 const exports={};const code=ts.transpileModule(readFileSync('components/projects/progress/incident-records-context.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports,require:name=>name==='react'?react:{jsx:(type,props)=>({type,props})},Object});
 return()=>{cursor=0;return exports.IncidentRecordsProvider({records,children:'Workspace'}).props.value;};
}
test('preloaded incident records are available immediately and refreshed task records survive reopening',()=>{
 const render=fixture({available:true,items:[{id:1,task_id:7},{id:2,task_id:8},{id:3,category_id:7}]});
 let cache=render();assert.equal(cache.items.length,3);
 cache.replaceTaskIncidents({kind:'task',id:7},[{id:4,task_id:7}]);cache=render();
 assert.deepEqual(Array.from(cache.items,row=>row.id),[2,3,4]);
 cache.replaceTaskIncidents({kind:'task',id:7},[]);cache=render();assert.deepEqual(Array.from(cache.items,row=>row.id),[2,3]);
});
test('a failed preload can recover from a successful empty background task refresh',()=>{
 const render=fixture({available:false,items:[]});assert.equal(render().available,false);
 render().replaceTaskIncidents({kind:'task',id:7},[]);assert.equal(render().available,true);
});
