import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, bindings = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => bindings[name], console, setTimeout });
  return exports;
}
const { createGanttOperationQueue } = load('./gantt-operation-queue.ts');
const { createScheduleMoveQueue } = load('./schedule-move-queue.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('100 rapid mixed changes followed by 100 Undo and Redo clicks retain exact gesture order', async () => {
  const queue = createGanttOperationQueue(), history = [0], calls = [];
  let value = 0, cursor = 0, active = 0, maxActive = 0;
  const enqueue = (name, run) => queue.run(async () => {
    active++; maxActive = Math.max(maxActive, active); await tick();
    calls.push(name); run(); active--;
  });
  const edits = Array.from({ length: 100 }, (_, i) => enqueue(`edit-${i}`, () => {
    value++; history.splice(++cursor); history.push(value);
  }));
  const undos = Array.from({ length: 100 }, (_, i) => enqueue(`undo-${i}`, () => value = history[--cursor]));
  const redos = Array.from({ length: 100 }, (_, i) => enqueue(`redo-${i}`, () => value = history[++cursor]));
  assert.equal(queue.pending, 300);
  await Promise.all([...edits, ...undos, ...redos]);
  assert.equal(maxActive, 1); assert.equal(value, 100); assert.equal(cursor, 100); assert.equal(queue.pending, 0);
  assert.deepEqual(calls, [...Array.from({length:100},(_,i)=>`edit-${i}`),...Array.from({length:100},(_,i)=>`undo-${i}`),...Array.from({length:100},(_,i)=>`redo-${i}`)]);
});

test('group moves, inline edits and history share one queue; a selected group is one undo step', async () => {
  const queue = createGanttOperationQueue(), history = [[0,0]], events = [];
  let value = [0,0], cursor = 0;
  const checkpoint = next => { value=next; history.splice(++cursor); history.push([...next]); };
  const moves = createScheduleMoveQueue(async changes => {
    await tick(); events.push('group'); checkpoint(changes.map(row => Number(row.start))); return {};
  }, run => queue.run(run));
  const callbacks = { onBusy() {}, onRollback() { assert.fail('Unexpected rollback'); }, onIdle() {} };
  const group = moves.enqueue([{kind:'task',id:1,start:'3',end:'4',previousStart:'0',previousEnd:'1'},
    {kind:'task',id:2,start:'3',end:'4',previousStart:'0',previousEnd:'1'}], callbacks);
  const rename = queue.run(async () => { events.push('rename'); checkpoint([4,3]); });
  const undo1 = queue.run(async () => { events.push('undo'); value=history[--cursor]; assert.deepEqual(value,[3,3]); });
  const undo2 = queue.run(async () => { value=history[--cursor]; assert.deepEqual(value,[0,0]); });
  await Promise.all([group,rename,undo1,undo2]);
  assert.deepEqual(events,['group','rename','undo']);
  await queue.run(async () => checkpoint([7,7]));
  assert.equal(history.length,2); assert.deepEqual(history[1],[7,7]); // Fresh edit invalidates redo.
});

test('a rejected edit or failed Undo never blocks later commands', async () => {
  const queue = createGanttOperationQueue(); let reached = false;
  const failure = queue.run(async () => { throw Error('Network interrupted'); });
  const next = queue.run(async () => { reached=true; });
  await assert.rejects(failure,/Network interrupted/); await next;
  assert.equal(reached,true); assert.equal(queue.pending,0);
});

test('the actual Gantt handlers accept repeated Undo/Redo clicks while saves are pending and always release busy state', async () => {
  const source=readFileSync(new URL('./gantt-chart-view.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('gantt.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=[];
  function visit(node) {
    if(ts.isFunctionDeclaration(node)&&['handleUndo','handleRedo','handleHistory','queueEdit'].includes(node.name?.text)) functions.push(node.getText(ast));
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.equal(functions.length,4);
  const script=ts.transpileModule(functions.join('\n')+'\nexports.handlers={handleUndo,handleRedo,queueEdit};',
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const queue=createGanttOperationQueue(), history=[0];let cursor=0,busy=false,active=0,maxActive=0,error=null;
  const globals={ exports:{},canEdit:true,savingSharedCost:false,historyReady:true,effectiveCanUndo:true,effectiveCanRedo:true,
    operationQueue:queue,historyQueued:{current:0},groupDragCleanup:{current:null},categoriesRef:{current:[]},
    setIsUndoRedoPending:value=>busy=value,setHistoryError:value=>error=value,markHistoryEdit(){},
    setHistoryAvailability(){},setRowMoves(){},setModalEdits(){},setOptimisticDeletions(){},setUndoRedoOverride(){},
    clearHistoryOverrides(){},setPendingNewPhase(){},setPendingNewTask(){},router:{refresh(){}},
    undoGanttAction:async()=>{active++;maxActive=Math.max(maxActive,active);await tick();cursor--;active--;return {success:true,categories:[],canUndo:cursor>0,canRedo:true};},
    redoGanttAction:async()=>{await tick();cursor++;return {success:true,categories:[],canUndo:true,canRedo:cursor<history.length-1};},projectId:7,
  };
  vm.runInNewContext(script,globals);const {queueEdit,handleUndo,handleRedo}=globals.exports.handlers;
  const edits=Array.from({length:100},(_,i)=>queueEdit(async()=>{await tick();history.push(i+1);cursor++;return {success:true};}));
  const undos=Array.from({length:100},()=>handleUndo());
  assert.equal(globals.historyQueued.current,100);assert.equal(busy,true);
  await Promise.all([...edits,...undos]);assert.equal(cursor,0);assert.equal(maxActive,1);assert.equal(busy,false);assert.equal(error,null);
  await Promise.all(Array.from({length:100},()=>handleRedo()));assert.equal(cursor,100);assert.equal(busy,false);
  globals.undoGanttAction=async()=>{throw Error('Offline');};await handleUndo();
  assert.equal(busy,false);assert.match(error,/reach the server/);assert.equal(globals.historyQueued.current,0);
});

test('renaming a just-created task reserves its gesture order before the server returns its ID', async () => {
  const source=readFileSync(new URL('./gantt-chart-view.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('gantt.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  for(const [kind,name]of [['task','handleTaskRename'],['category','handleCategoryRename']]) {
    let fn;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)fn=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);
    const queue=createGanttOperationQueue(),events=[];let finish;
    const gate=new Promise(resolve=>finish=resolve);
    const created=queue.run(async()=>{await gate;events.push('create');return 9;});
    const globals={exports:{},FormData,queueEdit:run=>queue.run(run),pendingNameCreations:{current:new Map([[`${kind}:-1`,created]])},inlineNameDrafts:{current:new Map()},
      setEditingTaskId(){},setEditingCategoryId(){},setScheduleError(){},setNameOverride(){},setCategoryNameOverride(){},clearNameOverride(){},clearCategoryNameOverride(){},router:{refresh(){}},projectId:7,
      renameTask:async(id,project,value)=>{assert.equal(id,9);assert.equal(value,'Typed immediately');events.push('rename');return {success:true};},
      updateCategory:async(id,project,prev,form)=>{assert.equal(id,9);assert.equal(form.get('categoryName'),'Typed immediately');events.push('rename');return {success:true};},
    };
    vm.runInNewContext(ts.transpileModule(fn+`\nexports.run=${name};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,globals);
    const rename=globals.exports.run(-1,'Typed immediately','New Task');
    const next=queue.run(async()=>events.push('other edit'));
    assert.equal(queue.pending,3);finish();await Promise.all([rename,next]);
    assert.deepEqual(events,['create','rename','other edit']);
  }
});

test('bar hues remain stable and varied; child progress contrasts, summaries white, standalone gray, milestones blue', () => {
  const { ganttBarColors } = load('./gantt-bar-colors.ts');
  const colors = Array.from({length:250},(_,i)=>ganttBarColors(i+1,'summary'));
  assert.equal(new Set(colors.map(row=>row.backgroundColor)).size,250);
  for(let id=1;id<=250;id++) {
    const parent=ganttBarColors(id,'summary'),child=ganttBarColors(id,'subtask');
    assert.equal(parent.backgroundColor,child.backgroundColor); assert.equal(parent.progressColor,'#ffffff');
    assert.notEqual(child.progressColor,child.backgroundColor);
    assert.deepEqual(ganttBarColors(id,'summary'),parent);
    assert.equal(ganttBarColors(id,'standalone').backgroundColor,'#b8c2cc');
    assert.equal(ganttBarColors(id,'milestone').backgroundColor,'#155dfc');
  }
});
