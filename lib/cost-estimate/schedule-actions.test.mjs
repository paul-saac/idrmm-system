import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function compile(text, mocks = {}, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => mocks[name] ?? {}, FormData, console, ...globals });
  return exports;
}
const dates = compile(source('./schedule-dates.ts'));
const { createGanttPreviewHistory } = compile(source('../../components/projects/progress/gantt-preview-history.ts'));
const selection = compile(source('../../components/projects/progress/gantt-bar-selection.ts'), { '@/lib/cost-estimate/schedule-dates': dates });
const { createScheduleMoveQueue } = compile(source('../../components/projects/progress/schedule-move-queue.ts'));
function ganttFunction(name) {
  const text=source('../../components/projects/progress/gantt-chart-view.tsx');
  const ast=ts.createSourceFile('gantt.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let fn;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)fn=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(fn);return fn;
}

test('optimistic new rows and their saved-ID replacements end three days after project start', async () => {
  for (const kind of ['category','task']) {
    const state={phases:[],tasks:[]};let finish;
    const pending=new Promise(resolve=>finish=resolve);
    const name=kind==='category'?'handleAddPhase':'handleAddSubtask';
    const { bind }=compile(`export function bind(c){const {queueEdit,canEdit,setScheduleError,projectId,projectStartDate,projectEndDate,projectScheduleDates,setEditingCategoryId,setPendingNewPhases,createCategory,pendingNameCreations,inlineNameDrafts,setCategoryNameOverride,setCollapsedPhaseIds,phaseRowId,setPendingNewTasks,setEditingTaskId,createTask,setNameOverride,ZERO_COSTS,creationSequence,previewHistory,clientRowKeys,setHistoryPreview,setUndoRedoOverride,refreshAfterSaves}=c;${ganttFunction('settleCreatedRow')};${ganttFunction(name)};return ${name};}`);
    const previewHistory=createGanttPreviewHistory([{id:2,tasks:[]}]);
    const save=bind({queueEdit:(fn,after)=>{previewHistory.edit(after);return fn();},canEdit:true,
      creationSequence:{current:0},previewHistory,clientRowKeys:{current:new Map()},setHistoryPreview(){},setUndoRedoOverride(){},refreshAfterSaves(){},
      projectId:7,projectStartDate:'2026-03-18',projectEndDate:'2027-04-15',projectScheduleDates:dates.projectScheduleDates,
      setScheduleError(){},setEditingCategoryId(){},setPendingNewPhases:fn=>state.phases=fn(state.phases),createCategory:()=>pending,
      pendingNameCreations:{current:new Map()},inlineNameDrafts:{current:new Map()},setCategoryNameOverride(){},setCollapsedPhaseIds(){},phaseRowId:id=>`phase-${id}`,
      setPendingNewTasks:fn=>state.tasks=fn(state.tasks),setEditingTaskId(){},createTask:()=>pending,setNameOverride(){},ZERO_COSTS:{labor:0,material:0,equipment:0,other:0}});
    const saving=save(2);
    const row=()=>kind==='category'?state.phases[0].category:state.tasks[0].task;
    assert.equal(row().plannedStartDate,'2026-03-18');assert.equal(row().plannedEndDate,'2026-03-21');assert.equal(row().percentComplete,0);
    finish(kind==='category'?{categoryId:9}:{taskId:9});await saving;
    assert.equal(row().id,9);assert.equal(row().plannedStartDate,'2026-03-18');assert.equal(row().plannedEndDate,'2026-03-21');
  }
});

function creationFixture({ authorized = true, projectError = null } = {}) {
  const writes = [], events = [];
  const client = { from(table) {
    const query = { select() { return query; }, eq() { return query; }, insert(value) { writes.push({ table, value: plain(value) }); return query; },
      async single() { return table === 'projects' ? { data: { start_date: '2026-03-18', target_end_date: '2026-04-15' }, error: projectError } : { data: { id: 9 }, error: null }; } };
    return query;
  } };
  const actions = compile(source('./actions.ts'), {
    './schedule-dates': dates,
    '@/lib/auth/project-access': { requireProjectAccess: async () => authorized ? { id: 'pm' } : null },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/cost-estimate/undo-redo': { recordGanttCheckpoint: async () => events.push('checkpoint') },
    '@/lib/projects/revalidate': { revalidateProjectPaths: () => events.push('refresh') },
  });
  return { actions, writes, events };
}
test('new standalone tasks and subtasks persist start plus three days, never project end or actual completion', async () => {
  for (const kind of ['category', 'task']) {
    const f = creationFixture(), form = new FormData();
    form.set(kind === 'category' ? 'categoryName' : 'taskName', 'New Task'); form.set('categoryId', '3');
    const result = await (kind === 'category' ? f.actions.createCategory : f.actions.createTask)(7, {}, form);
    assert.equal(result.success, true);
    const row = f.writes[0].value;
    assert.equal(row.planned_start_date, '2026-03-18'); assert.equal(row.planned_end_date, '2026-03-21');
    assert.equal(Object.hasOwn(row, 'percent_complete'), false);
    assert.deepEqual(f.events, ['checkpoint', 'refresh']);
  }
});
test('explicit task dates are preserved and milestone defaults stay one day', async () => {
  for (const milestone of [false, true]) {
    const f = creationFixture(), form = new FormData(); form.set('taskName', 'Work'); form.set('categoryId', '3');
    if (milestone) form.set('isMilestone', 'on');
    else { form.set('plannedStartDate', '2026-05-02'); form.set('plannedEndDate', '2026-05-08'); }
    assert.equal((await f.actions.createTask(7, {}, form)).success, true);
    assert.equal(f.writes[0].value.planned_end_date, milestone ? '2026-03-18' : '2026-05-08');
  }
});
test('failed project lookup or edit permission never creates a dateless task', async () => {
  for (const config of [{ authorized: false }, { projectError: { code: '42501' } }]) {
    const f = creationFixture(config), form = new FormData(); form.set('categoryName', 'Work');
    assert.ok((await f.actions.createCategory(7, {}, form)).error); assert.equal(f.writes.length, 0);
  }
});
test('Expected fills from the inherited schedule while actual completion remains zero without saved logs', () => {
  const calc = compile(source('../task-progress/calculate.ts'));
  const schedule = { plannedStartDate: '2026-03-18', plannedEndDate: '2026-04-15', workingDays: [1,2,3,4,5,6], holidays: [], today: new Date(2026, 2, 31) };
  assert.ok(calc.computeExpectedProgress(schedule).timePercent > 0);
  assert.equal(calc.computeAutoPercentComplete({ ...schedule, anchor: calc.EMPTY_PROGRESS_ANCHOR, estimatedQuantity: 10, plannedMaterials: [], plannedCosts: { labor: 0, material: 0, equipment: 0, other: 0 } }), 0);
});

const d = value => new Date(`${value}T00:00:00`);
const fixture = () => {
  const categories = [
    { id: 1, plannedStartDate: '2026-03-18', plannedEndDate: '2026-04-15', tasks: [] },
    { id: 2, tasks: [{ id: 1, plannedStartDate: '2026-03-20', plannedEndDate: '2026-03-23' }, { id: 2, plannedStartDate: '2026-03-25', plannedEndDate: '2026-03-25', isMilestone: true }] },
  ];
  const rows = [
    { id: 'phase-1', type: 'task', start: d('2026-03-18'), end: d('2026-04-16') },
    { id: 'phase-2', type: 'project', start: d('2026-03-20'), end: d('2026-03-26') },
    { id: '1', type: 'task', project: 'phase-2', start: d('2026-03-20'), end: d('2026-03-24') },
    { id: '2', type: 'milestone', project: 'phase-2', start: d('2026-03-25'), end: d('2026-03-25') },
    { id: 'filler', type: 'milestone', isDisabled: true, start: d('2026-03-18'), end: d('2026-03-18') },
  ]; return { categories, rows };
};
test('selected summaries and overlapping subtasks move once, with separate ID spaces and milestone dates', () => {
  const { categories, rows } = fixture();
  const before = plain({ categories, rows });
  const changes = selection.selectedBarChanges(new Set(['phase-1','phase-2','1','filler']), rows, categories, 3);
  assert.equal(changes.length, 3);
  assert.deepEqual(plain(changes.map(c => [c.kind, c.id, c.start, c.end])), [
    ['category',1,'2026-03-21','2026-04-18'], ['task',1,'2026-03-23','2026-03-26'], ['task',2,'2026-03-28','2026-03-28'],
  ]);
  assert.deepEqual(plain({ categories, rows }), before);
  assert.deepEqual(plain(selection.selectedBarChanges(new Set(['1']), rows, categories, 0)), []);
});
test('bar movement snaps consistently at all zoom levels and handles backwards/leap-year moves', () => {
  assert.equal(selection.barDragDays(120,60,'day',d('2026-03-18')),2);
  assert.equal(selection.barDragDays(50,50,'week',d('2026-03-18')),7);
  assert.equal(selection.barDragDays(100,100,'month',d('2024-03-18')),29);
  assert.equal(selection.barDragDays(-300,300,'year',d('2025-03-18')),-366);
  assert.equal(dates.shiftScheduleDate('2024-03-01',-1),'2024-02-29');
  assert.equal(dates.isScheduleDate('2026-02-31'),false);
});
test('Shift-click selects bars without opening progress; one drag previews and moves every selected bar', () => {
  const text=source('../../components/projects/progress/gantt-chart-view.tsx');
  const ast=ts.createSourceFile('gantt.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='handleBarSelectionMouseDown')handler=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(handler);
  const f=fixture(), listeners=new Map(), frames=[], connectorFrames=[];let scans=0,reads=0, connectorRestores=0;
  const win={addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:(event,fn)=>{if(listeners.get(event)===fn)listeners.delete(event);},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},setTimeout(){}};
  class Element {
    constructor(id){this.dataset={ganttRowId:id};this.attributes=new Map();this.ownerSVGElement={getBoundingClientRect:()=>{reads++;return {left:0};},getScreenCTM:()=>({a:1})};}
    closest(selector){return selector==='[data-gantt-row-id]'?this:null;}
    getAttribute(key){return this.attributes.get(key)??null;}setAttribute(key,value){this.attributes.set(key,value);}removeAttribute(key){this.attributes.delete(key);}
  }
  const bars=[new Element('phase-1'),new Element('1')], state={selected:new Set(),writes:[],opens:0};
  const context={createDependencyDragPreview:()=>({recache(){},paint:pixels=>connectorFrames.push(pixels),restore:()=>connectorRestores++}),canEdit:true,lastBarGestureWasDrag:{current:false},cancelBarClick(){},savingBarGroup:false,effectiveTasks:f.rows,categoriesForDisplay:f.categories,
    taskById:new Map([['1',{}],['2',{}]]),categoryById:new Map([['phase-1',{}],['phase-2',{}]]),
    setSelectedBarIds:value=>{state.selected=typeof value==='function'?value(state.selected):value;},
    chartWrapRef:{current:{querySelectorAll:()=>{scans++;return bars;}}},timelineExtent:{min:d('2026-03-18')},projectStartDate:'2026-03-18',toDate:d,
    pendingScheduleOverrides:new Map(),pendingCategoryScheduleOverrides:new Map(),phaseRowId:id=>`phase-${id}`,flushSync:fn=>fn(),
    view:'day',effectiveColumnWidth:60,groupDragCleanup:{current:null},handleBarClick:()=>state.opens++,barJustDraggedRef:{current:false},
    persistBarGroup:changes=>state.writes.push(plain(changes)),setBarGroupError:error=>{throw Error(error);},...selection};
  const { bind }=compile(`export function bind(c){const {canEdit,lastBarGestureWasDrag,cancelBarClick,savingBarGroup,selectedBarIds,setSelectedBarIds,effectiveTasks,categoriesForDisplay,taskById,categoryById,chartWrapRef,timelineExtent,projectStartDate,toDate,view,effectiveColumnWidth,groupDragCleanup,handleBarClick,barJustDraggedRef,persistBarGroup,setBarGroupError,barDragDays,selectedBarChanges,pendingScheduleOverrides,pendingCategoryScheduleOverrides,phaseRowId,flushSync,createDependencyDragPreview}=c;${handler};return handleBarSelectionMouseDown;}`,{}, {Element,window:win,MutationObserver:class{observe(){}disconnect(){}}});
  function down(bar,shiftKey,x=100,detail=1){let prevented=false;bind({...context,selectedBarIds:state.selected})({target:bar,shiftKey,button:0,detail,clientX:x,preventDefault(){prevented=true;},stopPropagation(){}});return prevented;}
  for(const bar of bars){assert.equal(down(bar,true),true);listeners.get('mouseup')({clientX:100});}
  assert.equal(state.selected.size,2);assert.equal(state.opens,0);assert.equal(state.writes.length,0);
  // Existing saves do not block a new drag, nor force whole-day preview jumps.
  context.savingBarGroup=true;
  down(bars[0],false);const initialScans=scans,initialReads=reads;
  listeners.get('mousemove')({clientX:104,preventDefault(){}});
  listeners.get('mousemove')({clientX:109,preventDefault(){}});
  assert.equal(frames.length,1);frames.shift()();
  for(const bar of bars)assert.match(bar.getAttribute('transform'),/translate\(9 0\)/);
  assert.equal(scans,initialScans);assert.equal(reads,initialReads);assert.equal(connectorFrames.at(-1),9);
  listeners.get('mousemove')({clientX:220,preventDefault(){}});frames.shift()();
  for(const bar of bars)assert.match(bar.getAttribute('transform'),/translate\(120 0\)/);
  assert.equal(connectorFrames.at(-1),120);
  const restoresBefore=connectorRestores;listeners.get('mouseup')({clientX:220});assert.equal(connectorRestores,restoresBefore+1);
  assert.equal(state.opens,0);assert.equal(state.writes.length,1);assert.equal(state.writes[0].length,2);
  assert.equal(state.writes[0][0].start,'2026-03-20');assert.equal(state.writes[0][1].start,'2026-03-22');
  for(const bar of bars)assert.equal(bar.getAttribute('transform'),null);
  // Shift stays usable during the group drag, and a plain Shift-click deselects.
  down(bars[0],true);listeners.get('mouseup')({clientX:100});assert.equal(state.selected.size,1);
  down(bars[1],true);listeners.get('mouseup')({clientX:160});assert.equal(state.writes.length,2);assert.equal(state.selected.size,1);
  // Unselected body drags also bypass the native library while earlier saves are pending.
  state.selected=new Set();
  assert.equal(down(bars[1],false),true);listeners.get('mouseup')({clientX:160});
  assert.equal(state.writes.length,3);assert.equal(state.writes[2].length,1);
  assert.equal(down(bars[1],false,100,2),true);listeners.get('mouseup')({clientX:220});assert.equal(state.writes.length,4);
  // A first-click's pointer jitter and a second-click press must not write dates.
  down(bars[1],false);listeners.get('mousemove')({clientX:102,preventDefault(){}});listeners.get('mouseup')({clientX:102});
  const writesBefore=state.writes.length;
  assert.equal(down(bars[1],false,100,2),true);assert.equal(listeners.has('mouseup'),false);
  assert.equal(state.writes.length,writesBefore);
});
test('group saves use one authorized RPC and one undo checkpoint, with explicit migration and conflict errors', async () => {
  for (const error of [null, { code: 'PGRST202' }, { code: '40001', message: 'Schedule changed.' }]) {
    const calls = [], events = [];
    const actions = compile(source('./schedule-actions.ts'), {
      './schedule-dates': dates,
      '@/lib/auth/project-access': { requireProjectAccess: async () => ({ id:'pm' }) },
      '@/lib/supabase/server': { createClient: async () => ({ rpc: async (...args) => { calls.push(args); return { error }; } }) },
      './undo-redo': { recordGanttCheckpoint: async () => events.push('checkpoint') },
      '@/lib/projects/revalidate': { revalidateProjectPaths: () => events.push('refresh') },
    });
    const f=fixture(), changes=selection.selectedBarChanges(new Set(['phase-2']),f.rows,f.categories,1);
    const result = await actions.moveSelectedSchedules(7,changes);
    assert.equal(calls.length,1); assert.equal(calls[0][0],'move_selected_schedules');
    assert.equal(calls[0][1].p_project_id,7);
    if (!error) { assert.equal(result.success,true); assert.deepEqual(events,['checkpoint','refresh']); }
    else { assert.match(result.error,error.code==='PGRST202' ? /0109/ : /Schedule changed/); assert.deepEqual(events,[]); }
  }
});

test('group date changes appear before the server responds and all optimistic changes roll back on failure', async () => {
  const {bind}=compile(`export function bind(c){const {updateScheduleOverrides,updateCategoryScheduleOverrides,barMoveQueue,groupDragCleanup,setBarGroupError,setSavingBarGroup,router,previewHistory,setHistoryPreview,refreshAfterSaves}=c;${ganttFunction('persistBarGroup')};return persistBarGroup;}`);
  const taskMap=new Map(),categoryMap=new Map(), state={saving:false,error:null,refreshes:0};let finish;
  const pending=new Promise(resolve=>finish=resolve);
  function update(map,entries){for(const [id,value]of entries){if(value===null)map.delete(id);else map.set(id,value);}}
  const save=bind({previewHistory:{invalidate(){}},setHistoryPreview(){},refreshAfterSaves:()=>state.refreshes++,setBarGroupError:v=>state.error=v,setSavingBarGroup:v=>state.saving=v,
    updateScheduleOverrides:entries=>update(taskMap,entries),updateCategoryScheduleOverrides:entries=>update(categoryMap,entries),
    barMoveQueue:{current:createScheduleMoveQueue(()=>pending)},groupDragCleanup:{current:null},router:{refresh:()=>state.refreshes++}});
  const f=fixture(),changes=selection.selectedBarChanges(new Set(['phase-1','1']),f.rows,f.categories,2);
  const saving=save(changes);
  assert.equal(state.saving,true);assert.equal(taskMap.get(1).start,'2026-03-22');assert.equal(categoryMap.get(1).start,'2026-03-20');
  finish({error:'Schedule changed.'});await saving;
  assert.equal(taskMap.get(1).start,'2026-03-20');assert.equal(categoryMap.get(1).start,'2026-03-18');assert.equal(state.error,'Schedule changed.');assert.equal(state.saving,false);assert.equal(state.refreshes,1);
});

test('permanent account deletion keeps authorization/history guards and reports failure inside the confirmation modal', async () => {
  const text=source('../../components/accounts/account-detail.tsx');
  const ast=ts.createSourceFile('account.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX); let fn;
  function visit(node) { if(ts.isFunctionDeclaration(node)&&node.name?.text==='handlePermanentDelete')fn=node.getText(ast);ts.forEachChild(node,visit); } visit(ast);assert.ok(fn);
  const { bind }=compile(`export function bind(c) {const {isSuperAdmin,detail,busy,setBusy,setDeleteError,deleteAccount,account,setDeleteOpen,router,onClose}=c; ${fn}; return handlePermanentDelete;}`);
  for(const config of [{isSuperAdmin:false},{hasHistory:true},{busy:'save'},{error:'Denied'},{}]) {
    const state={calls:0,closed:false,error:null,busy:null};
    const save=bind({isSuperAdmin:config.isSuperAdmin??true,detail:{hasHistory:config.hasHistory??false},busy:config.busy??null,
      setBusy:v=>state.busy=v,setDeleteError:v=>state.error=v,deleteAccount:async()=>{state.calls++;return config.error?{error:config.error}:{success:true};},
      account:{id:'test-id'},setDeleteOpen(){},router:{refresh(){}},onClose:()=>state.closed=true});
    await save();
    if(config.isSuperAdmin===false||config.hasHistory||config.busy)assert.equal(state.calls,0);
    else if(config.error){assert.equal(state.error,'Denied');assert.equal(state.closed,false);}
    else{assert.equal(state.calls,1);assert.equal(state.closed,true);assert.equal(state.busy,null);}
  }
});

test('new task defaults handle month/year boundaries, leap days and absent project dates',()=>{
  for(const [start,end] of [['2026-10-20','2026-10-23'],['2026-01-30','2026-02-02'],['2026-12-30','2027-01-02'],['2024-02-27','2024-03-01']]) {
    assert.deepEqual(plain(dates.projectScheduleDates(start,'2027-04-15')),{start,end});
  }
  assert.deepEqual(plain(dates.projectScheduleDates(null,null)),{start:null,end:null});
  assert.deepEqual(plain(dates.projectScheduleDates(null,'2026-10-20')),{start:'2026-10-20',end:'2026-10-23'});
});
