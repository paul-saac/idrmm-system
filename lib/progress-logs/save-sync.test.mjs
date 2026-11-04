import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';
const compile=file=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
function fixture(){
 const slots=[],effects=[];let cursor=0,refreshes=0;
 const react={createContext:()=>({Provider:'Provider'}),useState(initial){const slot=cursor++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],value=>{slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},useMemo:fn=>fn(),useEffect(fn){effects.push(fn);}};
 react.useRef=initial=>react.useState(()=>({current:initial}))[0];
 const exports={};runInNewContext(compile('components/projects/progress/progress-log-sync.tsx'),{exports,Date,Set,Map,JSON,Error,require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='next/navigation'?{useRouter:()=>({refresh(){refreshes++;}})}:{projectProgressLog:(before,history,date,log)=>({progress:{cumulativeQuantityCompleted:log?.quantityCompleted ?? 0,cumulativeCosts:{labor:0,material:0,equipment:0,other:0},loggedDates:log?[date]:[]},history:log?[log,...history]:[]})}});
 const props={task:{},category:{},history:{},children:'Workspace'};
 const render=()=>{cursor=0;effects.length=0;const tree=exports.ProgressLogSyncProvider(props);effects.splice(0).forEach(fn=>fn());return tree;};
 return{props,render,get refreshes(){return refreshes;}};
}
const date='2026-11-03',log={id:-1,entryDate:date,quantityCompleted:2},item={kind:'task',id:1};
test('Save waits for server confirmation but stops being busy before refreshed workspace records arrive',async()=>{
 const f=fixture();let finish,calls=0;
 const operation=f.render().props.value.run(item,date,log,()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 let settled=false;operation.completion.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
 let tree=f.render();assert.equal(tree.props.value.task[1].cumulativeQuantityCompleted,2);assert.equal(tree.props.value.pendingKeys[0],'task-1');
 assert.doesNotMatch(JSON.stringify(tree.props.children),/Saving progress changes/);
 assert.equal(tree.props.value.run(item,date,log,async()=>{calls++;return{success:true};}),false);assert.equal(calls,1);
 finish({success:true});assert.equal((await operation.completion).success,true);assert.equal(f.refreshes,1);
 tree=f.render();assert.equal(tree.props.value.pendingKeys.length,0);
 // Keep the confirmed record on screen while stale route props are refreshing.
 assert.equal(tree.props.value.task[1].cumulativeQuantityCompleted,2);
 assert.equal(tree.props.value.history['task-1'][0].id,-1);
 // Still protect against competing saves until canonical records are reconciled.
 assert.equal(tree.props.value.run(item,date,log,async()=>({success:true})),false);
 f.props.history={'task-1':[{...log,id:4}]};tree=f.render();assert.equal(tree.props.value.pendingKeys.length,0);
});
test('failed saves roll back optimistic data and return a retryable error to the modal',async()=>{
 const f=fixture();const operation=f.render().props.value.run(item,date,log,async()=>({error:'Write rejected'}));
 assert.equal((await operation.completion).error,'Write rejected');const tree=f.render();
 assert.equal(tree.props.value.task[1],undefined);assert.equal(tree.props.value.pendingKeys.length,0);
 assert.ok(tree.props.value.run(item,date,log,async()=>({success:true})));
});
