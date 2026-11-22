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
 // A completed request releases the guard even while route props are stale.
 const deletion=tree.props.value.run(item,date,null,async()=>({success:true}));
 assert.ok(deletion);assert.equal((await deletion.completion).success,true);
 tree=f.render();assert.equal(tree.props.value.history['task-1']?.length ?? 0,0);
 assert.equal(tree.props.value.task[1]?.cumulativeQuantityCompleted ?? 0,0);
 f.props.history={'task-1':[{...log,id:4}]};tree=f.render();assert.equal(tree.props.value.pendingKeys.length,0);
});
test('failed saves roll back optimistic data and return a retryable error to the modal',async()=>{
 const f=fixture();const operation=f.render().props.value.run(item,date,log,async()=>({error:'Write rejected'}));
 assert.equal((await operation.completion).error,'Write rejected');const tree=f.render();
 assert.equal(tree.props.value.task[1],undefined);assert.equal(tree.props.value.pendingKeys.length,0);
 assert.ok(tree.props.value.run(item,date,log,async()=>({success:true})));
});


test('failed immediate deletion restores the confirmed save while refresh is delayed',async()=>{
 const f=fixture();
 const save=f.render().props.value.run(item,date,log,async()=>({success:true}));
 await save.completion;
 let finish;
 const deletion=f.render().props.value.run(item,date,null,()=>new Promise(resolve=>{finish=resolve;}));
 assert.ok(deletion);
 let tree=f.render();assert.equal(tree.props.value.pendingKeys[0],'task-1');
 assert.equal(tree.props.value.run(item,date,log,async()=>({success:true})),false);
 finish({error:'Delete rejected'});await deletion.completion;
 tree=f.render();assert.equal(tree.props.value.pendingKeys.length,0);
 assert.equal(tree.props.value.task[1].cumulativeQuantityCompleted,2);
 assert.equal(tree.props.value.history['task-1'][0].id,-1);
});

test('consecutive confirmed changes keep only the latest task projection',async()=>{
 const f=fixture();
 await f.render().props.value.run(item,date,log,async()=>({success:true})).completion;
 const edited={...log,id:-2,quantityCompleted:3};
 await f.render().props.value.run(item,date,edited,async()=>({success:true})).completion;
 let tree=f.render();assert.equal(tree.props.value.task[1].cumulativeQuantityCompleted,3);
 const deletion=tree.props.value.run(item,date,null,async()=>({success:true}));
 assert.ok(deletion);await deletion.completion;
 tree=f.render();assert.equal(tree.props.value.history['task-1']?.length ?? 0,0);
 assert.equal(tree.props.value.pendingKeys.length,0);
 assert.equal(f.refreshes,3);
});


test('a delayed save refresh cannot resurrect a successfully deleted log',async()=>{
 const f=fixture();
 await f.render().props.value.run(item,date,log,async()=>({success:true})).completion;
 await f.render().props.value.run(item,date,null,async()=>({success:true})).completion;
 let tree=f.render();assert.equal(tree.props.value.history['task-1']?.length ?? 0,0);
 // An earlier refresh may arrive before the deletion refresh.
 f.props.history={'task-1':[{...log,id:4}]};
 tree=f.render();assert.equal(tree.props.value.history['task-1'].length,0);
 assert.equal(tree.props.value.pendingKeys.length,0);
 f.props.history={'task-1':[]};
 tree=f.render();assert.equal(tree.props.value.history['task-1'].length,0);
});


test('an earlier save refresh does not replace a newer confirmed edit',async()=>{
 const f=fixture();
 await f.render().props.value.run(item,date,log,async()=>({success:true})).completion;
 await f.render().props.value.run(item,date,{...log,id:-2,quantityCompleted:3},async()=>({success:true})).completion;
 f.props.history={'task-1':[{...log,id:4}]};
 let tree=f.render();assert.equal(tree.props.value.task[1].cumulativeQuantityCompleted,3);
 assert.equal(tree.props.value.pendingKeys.length,0);
 f.props.history={'task-1':[{...log,id:5,quantityCompleted:3},{...log,id:4}]};
 f.props.task={1:{cumulativeQuantityCompleted:3,cumulativeCosts:{labor:0,material:0,equipment:0,other:0},loggedDates:[date]}};
 tree=f.render();assert.equal(tree.props.value.task[1].cumulativeQuantityCompleted,3);
});


test('a delayed refresh with unchanged totals cannot erase newly saved remarks or photos',async()=>{
 const f=fixture();
 f.props.history={'task-1':[{...log,id:4}]};
 const edited={...log,id:-2,remarks:'Work stopped',photos:[{path:'1/user/photo'}]};
 await f.render().props.value.run(item,date,edited,async()=>({success:true})).completion;
 f.props.task={1:{cumulativeQuantityCompleted:2,cumulativeCosts:{labor:0,material:0,equipment:0,other:0},loggedDates:[date]}};
 let tree=f.render();assert.equal(tree.props.value.history['task-1'][0].remarks,'Work stopped');
 f.props.history={'task-1':[{...edited,id:5},{...log,id:4}]};
 tree=f.render();assert.equal(tree.props.value.history['task-1'][0].id,5);
});


test('confirmation replaces the temporary history ID before refresh and permits immediate edit and delete',async()=>{
 const f=fixture();let finish;
 const operation=f.render().props.value.run(item,date,log,()=>new Promise(resolve=>{finish=resolve;}));
 let tree=f.render();assert.equal(tree.props.value.pendingDates['task-1'],date);assert.equal(tree.props.value.history['task-1'][0].id,-1);
 finish({success:true,savedLog:{id:42,createdAt:'2026-11-03T11:08:00Z'}});await operation.completion;
 tree=f.render();assert.equal(tree.props.value.pendingKeys.length,0);assert.equal(tree.props.value.pendingDates['task-1'],undefined);
 assert.equal(tree.props.value.history['task-1'][0].id,42);assert.equal(tree.props.value.history['task-1'][0].createdAt,'2026-11-03T11:08:00Z');
 assert.equal(tree.props.value.history['task-1'][0].quantityCompleted,2);
 const deletion=tree.props.value.run(item,date,null,async()=>({success:true}));assert.ok(deletion);await deletion.completion;
});
