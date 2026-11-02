import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('./gantt-chart-view.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('gantt.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function handlers(names,state){
 const found=new Map();
 function visit(node){if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))found.set(node.name.text,node.getText(ast));ts.forEachChild(node,visit);}
 visit(ast);for(const name of names)assert.ok(found.has(name),name);
 const js=ts.transpileModule([...found.values()].join('\n')+';exports.handlers={'+names.join(',')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 state.exports={};runInNewContext(js,state);return state.exports.handlers;
}
function fixture(){
 const pending=new Map(),categories=new Map(),timers=new Map(),opened=[],edits=[];let sequence=0;
 const task={id:11,name:'Footings',plannedStartDate:'2026-11-01',plannedEndDate:'2026-11-03'};
 const category={id:2,name:'Phase',hasTasks:false,isMilestone:false};
 const state={canEdit:true,barJustDraggedRef:{current:false},barClickTimer:{current:null},FILLER_ROW_ID_PREFIX:'filler-',
  taskById:new Map([['11',task]]),categoryById:new Map([['phase-2',category]]),pendingScheduleOverrides:pending,pendingCategoryScheduleOverrides:categories,
  setTaskModal:value=>edits.push(['task',value]),setCategoryModal:value=>edits.push(['category',value]),setProgressModal:value=>opened.push(value),openBarProgress:value=>opened.push(value),
  setTimeout:callback=>{const id=++sequence;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
 return {state,timers,opened,edits,task,category,pending};
}
test('double-click cancels progress and opens the correct task edit with its latest optimistic dates',()=>{
 const f=fixture();const h=handlers(['cancelBarClick','handleBarClick','handleBarDoubleClick'],f.state);
 f.pending.set(11,{start:'2026-11-05',end:'2026-11-07'});
 h.handleBarClick({id:'11',type:'task'});h.handleBarClick({id:'11',type:'task'});
 assert.equal(f.opened.length,0);assert.equal(f.timers.size,1);
 h.handleBarDoubleClick({id:'11',type:'task'});
 assert.equal(f.timers.size,0);assert.equal(f.edits.length,1);assert.equal(f.edits[0][1].plannedStartDate,'2026-11-05');
 assert.equal(f.opened.at(-1),null);
 assert.match(source,/onDoubleClick=\{handleBarDoubleClick\}/);
});
test('single-click still opens progress; parent and milestone double-clicks use their existing edit form',()=>{
 const f=fixture(),h=handlers(['cancelBarClick','handleBarClick','handleBarDoubleClick'],f.state);
 const row={id:'11',type:'task'};h.handleBarClick(row);[...f.timers.values()][0]();assert.equal(f.opened[0],row);
 f.category.hasTasks=true;h.handleBarDoubleClick({id:'phase-2',type:'project'});assert.equal(f.edits.at(-1)[0],'category');
 f.task.isMilestone=true;h.handleBarDoubleClick({id:'11',type:'milestone'});assert.equal(f.edits.at(-1)[0],'task');
});
test('read-only, filler, pending rows and drag-generated double-clicks cannot open edit',()=>{
 const f=fixture(),h=handlers(['cancelBarClick','handleBarClick','handleBarDoubleClick'],f.state);
 f.state.canEdit=false;h.handleBarDoubleClick({id:'11'});
 f.state.canEdit=true;f.state.barJustDraggedRef.current=true;h.handleBarDoubleClick({id:'11'});
 f.state.barJustDraggedRef.current=false;h.handleBarDoubleClick({id:'filler-1'});h.handleBarDoubleClick({id:'-1'});
 assert.equal(f.edits.length,0);
});
test('single bar moves commit locally and return immediately while persistence is unresolved',()=>{
 const f=fixture(),changes=[];let flushed=0,cancelled=0;
 const state={...f.state,nativeBarDragMoved:{current:true},categoriesForDisplay:[{id:2,plannedStartDate:'2026-11-01',plannedEndDate:'2026-11-03'}],
  toIsoDate:value=>value,trueEndDate:row=>row.end,cancelBarClick:()=>cancelled++,flushSync:run=>{flushed++;run();},
  persistBarGroup:batch=>{changes.push(batch[0]);const c=batch[0];(c.kind==='task'?f.pending:f.state.pendingCategoryScheduleOverrides).set(c.id,{start:c.start,end:c.end});return new Promise(()=>{});}};
 const h=handlers(['persistDrag'],state);
 assert.equal(h.persistDrag({id:'11',type:'task',start:'2026-11-04',end:'2026-11-06'}),true);
 assert.equal(h.persistDrag({id:'11',type:'task',start:'2026-11-07',end:'2026-11-09'}),true);
 assert.equal(changes[1].previousStart,'2026-11-04');assert.equal(flushed,2);assert.equal(cancelled,2);
 assert.equal(h.persistDrag({id:'phase-2',type:'milestone',start:'2026-11-04',end:'2026-11-04'}),true);
 assert.equal(changes[2].kind,'category');assert.equal(h.persistDrag({id:'phase-2',type:'project'}),false);
 state.nativeBarDragMoved.current=false;
 assert.equal(h.persistDrag({id:'11',type:'task',start:'2026-10-31',end:'2026-11-02'}),false);
 assert.equal(changes.length,3);
 state.canEdit=false;assert.equal(h.persistDrag({id:'11',type:'task'}),false);
});

test('different tasks update immediately while the first save remains unresolved; saves retain gesture order',async()=>{
 const queueExports={};
 runInNewContext(ts.transpileModule(readFileSync(new URL('./schedule-move-queue.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:queueExports});
 let release;const firstSave=new Promise(resolve=>release=resolve),calls=[],dates=new Map();
 const queue=queueExports.createScheduleMoveQueue(async batch=>{calls.push(batch[0].id);if(calls.length===1)await firstSave;return {};});
 const state={setBarGroupError(){},updateScheduleOverrides:entries=>{for(const[id,value]of entries)dates.set(id,value);},updateCategoryScheduleOverrides(){},
  barMoveQueue:{current:queue},setSavingBarGroup(){},previewHistory:{invalidate(){}},setHistoryPreview(){},groupDragCleanup:{current:null},refreshAfterSaves(){}};
 const h=handlers(['persistBarGroup'],state);
 const move=id=>[{kind:'task',id,start:'2026-11-05',end:'2026-11-07',previousStart:'2026-11-01',previousEnd:'2026-11-03'}];
 const first=h.persistBarGroup(move(11)),second=h.persistBarGroup(move(12));
 assert.equal(dates.get(11).start,'2026-11-05');assert.equal(dates.get(12).start,'2026-11-05');
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[11]);
 release();await Promise.all([first,second]);assert.deepEqual(calls,[11,12]);
});
