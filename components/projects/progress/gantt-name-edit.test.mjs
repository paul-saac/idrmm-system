import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Exercise the actual name-cell JSX and create/rename handlers with delayed
// server actions. No authentication or live project data is involved.
const require = createRequire(import.meta.url);
const { createGanttOperationQueue } = compile(readFileSync(new URL('./gantt-operation-queue.ts', import.meta.url), 'utf8'));
const { createGanttPreviewHistory } = compile(readFileSync(new URL('./gantt-preview-history.ts', import.meta.url), 'utf8'));
const { projectScheduleDates } = compile(readFileSync(new URL('../../../lib/cost-estimate/schedule-dates.ts', import.meta.url), 'utf8'));
const source = readFileSync(new URL('./gantt-chart-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('gantt-chart-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); }
  visit(ast);assert.ok(result, 'Gantt source fixture must match a real handler/input');return result.getText(ast);
}
function compile(body) {
  const exports = {};
  const code = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, require, Date, Map, Set, FormData });return exports;
}
function nameInput(kind, context) {
  const input = find(node => ts.isJsxSelfClosingElement(node) && node.attributes.properties.some(prop =>
    ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'aria-label' && prop.initializer?.text === (kind === 'task' ? 'Task name' : 'Phase name')));
  const { render } = compile(`const ProjectWriteInput = 'input';
    export function render({ task, category, inlineNameDrafts, pendingNameOverrides = new Map(), pendingCategoryNameOverrides = new Map(),
      isGroup = false, isMilestoneRow = false, handleTaskRename = () => {}, handleCategoryRename = () => {},
      setEditingTaskId = () => {}, setEditingCategoryId = () => {}, clientRowKey = (kind,id) => kind + ":" + id }) { return (${input}); }`);
  return render(context).props;
}
function actualHandler(name, context) {
  const fn = find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const settle = ['handleAddPhase','handleAddSubtask'].includes(name)
    ? find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'settleCreatedRow') : '';
  return compile(`export function bind(context) {
    const { canEdit, projectId, categories, setScheduleError,
      setEditingCategoryId, setEditingTaskId, setPendingNewPhases, setPendingNewTasks, setCollapsedPhaseIds,
      phaseRowId, ZERO_COSTS, createCategory, createTask, pendingNameCreations, inlineNameDrafts,
      setCategoryNameOverride, setNameOverride, clearCategoryNameOverride, clearNameOverride,
      updateCategory, renameTask, queueEdit, previewHistory, creationSequence, clientRowKeys,
      setHistoryPreview, setUndoRedoOverride, refreshAfterSaves, projectScheduleDates, projectStartDate, projectEndDate } = context;
    ${settle}
    ${fn}
    return ${name};
  }`).bind(context);
}
function fixture() {
  let finish;
  const created = new Promise(resolve => finish = resolve);
  const state = { pendingTasks: [], pendingPhases: [], editingTask: null, editingPhase: null, error: null };
  Object.defineProperties(state, {
    pendingTask: { get: () => state.pendingTasks.at(-1) },
    pendingPhase: { get: () => state.pendingPhases.at(-1) },
  });
  const drafts = { current: new Map() }, pendingNameCreations = { current: new Map() };
  const taskOverrides = new Map(), phaseOverrides = new Map(), saves = [], requests = [], refreshes = [];
  const setter = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const queue = createGanttOperationQueue(), previewHistory = createGanttPreviewHistory([{id:9,name:'Parent',tasks:[]}]);
  const context = {
    canEdit: true, projectId: 7, categories: [], previewHistory,
    creationSequence: {current:0}, clientRowKeys: {current:new Map()},
    projectScheduleDates, projectStartDate:'2026-10-01', projectEndDate:'2026-12-15',
    setHistoryPreview:setter('preview'), setUndoRedoOverride:setter('override'),
    queueEdit: (run,after) => { previewHistory.edit(after); return queue.run(run); },
    refreshAfterSaves: () => queue.whenIdle(() => refreshes.push(true)),
    setScheduleError: setter('error'),
    setEditingCategoryId: setter('editingPhase'), setEditingTaskId: setter('editingTask'),
    setPendingNewPhases: setter('pendingPhases'), setPendingNewTasks: setter('pendingTasks'),
    setCollapsedPhaseIds: fn => fn(new Set()), phaseRowId: id => `phase-${id}`,
    ZERO_COSTS: { labor: 0, material: 0, equipment: 0, other: 0 },
    createTask: (_project, _state, form) => { requests.push(form); return created; },
    createCategory: (_project, _state, form) => { requests.push(form); return created; },
    inlineNameDrafts: drafts, pendingNameCreations,
    setNameOverride: (id, value) => taskOverrides.set(id, value),
    setCategoryNameOverride: (id, value) => phaseOverrides.set(id, value),
    clearNameOverride: id => taskOverrides.delete(id), clearCategoryNameOverride: id => phaseOverrides.delete(id),
    renameTask: async (id, project, value) => { saves.push({ id, project, value }); return { success: true }; },
    updateCategory: async (id, project, _state, form) => { saves.push({ id, project, value: form.get('categoryName') }); return { success: true }; },
  };
  return { context, state, drafts, taskOverrides, phaseOverrides, finish, saves, requests, refreshes, queue };
}
function type(props, value, caret = value.length) {
  props.onChange({ currentTarget: { value, selectionStart: caret, selectionEnd: caret } });
}

for (const kind of ['task', 'category']) {
  test(`${kind} name survives creation finishing and stale server refreshes during typing`, async () => {
    const f = fixture();
    const add = actualHandler(kind === 'task' ? 'handleAddSubtask' : 'handleAddPhase', f.context);
    const creating = add(9);
    const temporary = kind === 'task' ? f.state.pendingTask.task : f.state.pendingPhase.category;
    assert.ok(temporary.id < 0);
    const overrides = kind === 'task' ? f.taskOverrides : f.phaseOverrides;
    const cell = item => nameInput(kind, { task: item, category: item, inlineNameDrafts: f.drafts, pendingNameOverrides: overrides, pendingCategoryNameOverrides: overrides });
    const before = cell(temporary);
    assert.equal(before.defaultValue, 'New Task');
    type(before, 'Concrete excavation', 8);
    // A loading/notification/revalidation rerender while insertion is pending.
    assert.equal(cell({ ...temporary }).defaultValue, 'Concrete excavation');
    f.finish(kind === 'task' ? { taskId: 44 } : { categoryId: 44 });
    await creating;
    const real = kind === 'task' ? f.state.pendingTask.task : f.state.pendingPhase.category;
    assert.equal(real.id, 44);
    assert.equal(cell(real).defaultValue, 'Concrete excavation');
    assert.equal(f.drafts.current.has(`${kind}:${temporary.id}`), false);
    assert.equal(f.drafts.current.get(`${kind}:44`).value, 'Concrete excavation');
    // usePendingOverrides expires on fresh categories; the draft must outlive it.
    overrides.clear();
    const refreshed = cell({ ...real, name: 'New Task' });
    assert.equal(refreshed.defaultValue, 'Concrete excavation');
    const selected = [];
    refreshed.onFocus({ currentTarget: { setSelectionRange: (...range) => selected.push(range), select: () => assert.fail('Must not reselect the placeholder') } });
    assert.deepEqual(selected, [[8, 8]]);
    type(refreshed, 'Concrete excavation and backfill');
    assert.equal(cell({ ...real, name: 'New Task' }).defaultValue, 'Concrete excavation and backfill');
  });

  test(`${kind} name commits on blur after the real ID arrives and clears its editing draft`, async () => {
    const f = fixture();const item = { id: 44, name: 'New Task' };
    f.drafts.current.set(`${kind}:44`, { value: 'Foundation', start: 10, end: 10 });
    const rename = actualHandler(kind === 'task' ? 'handleTaskRename' : 'handleCategoryRename', f.context);
    await rename(44, 'Foundation', 'New Task');
    assert.deepEqual(f.saves, [{ id: 44, project: 7, value: 'Foundation' }]);
    assert.equal(f.drafts.current.has(`${kind}:44`), false);
    const overrides = kind === 'task' ? f.taskOverrides : f.phaseOverrides;
    assert.equal(nameInput(kind, { task: item, category: item, inlineNameDrafts: f.drafts, pendingNameOverrides: overrides, pendingCategoryNameOverrides: overrides }).defaultValue, 'Foundation');
    // An unrelated later rename must not resurrect the completed draft.
    assert.equal(nameInput(kind, { task: { ...item, name: 'Footings' }, category: { ...item, name: 'Footings' }, inlineNameDrafts: f.drafts }).defaultValue, 'Footings');
  });

  test(`${kind} name blurring before creation waits for its real ID instead of saving a temporary ID`, async () => {
    const f = fixture();const add = actualHandler(kind === 'task' ? 'handleAddSubtask' : 'handleAddPhase', f.context);
    const creating = add(9);
    const temporary = kind === 'task' ? f.state.pendingTask.task : f.state.pendingPhase.category;
    f.drafts.current.set(`${kind}:${temporary.id}`, { value: 'Masonry', start: 7, end: 7 });
    const rename = actualHandler(kind === 'task' ? 'handleTaskRename' : 'handleCategoryRename', f.context);
    const saving = rename(temporary.id, 'Masonry', 'New Task');
    assert.equal(f.saves.length, 0);
    f.finish(kind === 'task' ? { taskId: 44 } : { categoryId: 44 });
    await Promise.all([creating, saving]);
    assert.deepEqual(f.saves, [{ id: 44, project: 7, value: 'Masonry' }]);
  });

  test(`${kind} name Escape discards the draft without committing it`, () => {
    const f = fixture();const item = { id: 44, name: 'New Task' };
    const props = nameInput(kind, { task: item, category: item, inlineNameDrafts: f.drafts,
      setEditingTaskId: f.context.setEditingTaskId, setEditingCategoryId: f.context.setEditingCategoryId });
    type(props, 'Discard this');props.onKeyDown({ key: 'Escape' });
    assert.equal(f.drafts.current.has(`${kind}:44`), false);assert.equal(f.saves.length, 0);
    assert.equal(nameInput(kind, { task: item, category: item, inlineNameDrafts: f.drafts }).defaultValue, 'New Task');
  });
}

for (const kind of ['task','category']) {
  test(`50 rapid ${kind} additions render immediately, keep unique keys, and survive individual failures`, async () => {
    const f=fixture(); let saved=100;
    f.context[kind==='task'?'createTask':'createCategory']=async()=> {
      const id=++saved;
      if(id===110) return {error:'Rejected test save'};
      return kind==='task'?{taskId:id}:{categoryId:id};
    };
    const add=actualHandler(kind==='task'?'handleAddSubtask':'handleAddPhase',f.context);
    const calls=Array.from({length:50},()=>add(9));
    const rows=()=>kind==='task'?f.state.pendingTasks.map(e=>e.task):f.state.pendingPhases.map(e=>e.category);
    const before=rows();
    assert.equal(before.length,50); assert.equal(new Set(before.map(r=>r.id)).size,50);
    assert.ok(before.every(r=>r.id<0));
    assert.ok(before.every(r=>r.plannedStartDate==='2026-10-01'&&r.plannedEndDate==='2026-10-04'));
    assert.equal(f.state[kind==='task'?'editingTask':'editingPhase'],before.at(-1).id);
    await Promise.all(calls);
    assert.equal(rows().length,49);assert.ok(rows().every(r=>r.id>0));
    for(const row of rows())assert.ok(f.context.clientRowKeys.current.get(`${kind}:${row.id}`).startsWith(`${kind}:-`));
    assert.equal(f.queue.pending,0); assert.match(f.state.error,/Rejected/);
  });
}

test('a subtask can be added and named before its new parent has saved',async()=>{
  const f=fixture(); let release;
  const parentGate=new Promise(resolve=>release=resolve);
  f.context.createCategory=async()=>{await parentGate;return {categoryId:55};};
  f.context.createTask=async(_project,_state,form)=>{assert.equal(form.get('categoryId'),'55');return {taskId:56};};
  const parent=actualHandler('handleAddPhase',f.context)();
  const temporaryParent=f.state.pendingPhase.category.id;
  const child=actualHandler('handleAddSubtask',f.context)(temporaryParent);
  assert.equal(f.state.pendingTask.categoryId,temporaryParent);
  const temporaryTask=f.state.pendingTask.task.id;
  const rename=actualHandler('handleTaskRename',f.context)(temporaryTask,'Foundation','New Task');
  release(); await Promise.all([parent,child,rename]);
  assert.equal(f.state.pendingTask.categoryId,55);
  assert.deepEqual(f.saves,[{id:56,project:7,value:'Foundation'}]);
});
