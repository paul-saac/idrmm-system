import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const plain = value => JSON.parse(JSON.stringify(value));
function compile(source, globals = {}, dependencies = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => dependencies[name], Date, Map, Set, Error, ...globals });
  return exports;
}
const weights = compile(readFileSync(new URL('./weights.ts', import.meta.url), 'utf8'));
const calculate = compile(readFileSync(new URL('../task-progress/calculate.ts', import.meta.url), 'utf8'));
const model = compile(readFileSync(new URL('./live-estimate.ts', import.meta.url), 'utf8'), {}, {
  './weights': weights, '@/lib/task-progress/calculate': calculate,
});
const { applyEstimatePatches, applyEstimateChanges, liveCostEstimate, unconfirmedEstimateChanges, withSavedEstimateProgress } = model;
const zero = () => ({ labor: 0, material: 0, equipment: 0, other: 0 });
const task = (id, values = {}) => ({ id, categoryId: 2, name: `Task ${id}`, estimatedQuantity: 10, unit: 'm',
  laborEstimate: 100, materialEstimate: 300, equipmentEstimate: 0, otherCostEstimate: 0, totalEstimateCost: 400,
  materialAssignments: [], percentComplete: 0, costsToDate: zero(), ...values });
const category = (id, values = {}) => ({ id, name: `Main task ${id}`, estimatedQuantity: 1, unit: 'lot', tasks: [],
  categoryLaborEstimate: 0, categoryMaterialEstimate: 0, categoryEquipmentEstimate: 0, categoryOtherEstimate: 0,
  materialAssignments: [], percentComplete: 0, costsToDate: zero(), ...values });
const fixture = () => ({ lifecycle: { status: 'planning' }, categories: [
  category(1, { categoryLaborEstimate: 50, categoryMaterialEstimate: 100, costsToDate: { ...zero(), labor: 20, material: 30 } }),
  category(2, { categoryMaterialEstimate: 50, costsToDate: { ...zero(), material: 999 }, tasks: [
    task(11, { costsToDate: { ...zero(), labor: 10, material: 30 }, predecessorTaskId: 12 }),
    task(12, { materialEstimate: 250, equipmentEstimate: 50, costsToDate: { ...zero(), labor: 5, material: 15, equipment: 5 } }),
  ] }),
], summary: {} });

test('cost save immediately updates task total, project totals and both Gantt/cost weights without changing saved expenses', () => {
  const source = fixture(), original = plain(source);
  const patches = [{ kind: 'task', id: 11, values: { materialEstimate: 500 } }];
  const categories = applyEstimatePatches(source.categories, patches);
  const result = liveCostEstimate(source, categories);
  assert.equal(result.categories[1].tasks[0].totalEstimateCost, 600);
  assert.equal(result.summary.totalEstimatedCost, 1200);
  assert.deepEqual(plain(result.summary.totalsByColumn), { labor: 250, material: 900, equipment: 50, other: 0 });
  assert.equal(result.categories[0].weight, 12.5);
  assert.equal(result.categories[1].weight, 87.5);
  assert.equal(result.categories[1].tasks[0].weight, 52.5);
  assert.deepEqual(plain(result.summary.costsToDate), { labor: 35, material: 75, equipment: 5, other: 0 });
  assert.deepEqual(plain(source), original);
});

test('Gantt add, rename, delete and reorder projections update cost rows and counts without waiting for a server refresh', () => {
  const source = fixture();
  const added = [...source.categories, category(-1, { name: 'New Task' })];
  let result = liveCostEstimate(source, added);
  assert.equal(result.summary.categoryCount, 3); assert.equal(result.categories.at(-1).name, 'New Task');
  result = liveCostEstimate(source, [added[2], { ...added[1], name: 'Concrete', tasks: [added[1].tasks[1]] }]);
  assert.deepEqual(plain(result.categories.map(row => row.id)), [-1, 2]);
  assert.equal(result.categories[1].name, 'Concrete');
  assert.equal(result.summary.taskCount, 1); assert.equal(result.summary.totalEstimatedCost, 450);
});

test('edits in either direction compose by field and by row kind; rolling back one save preserves the others', () => {
  const source = fixture(); source.categories[1].tasks[0].id = 1;
  const changes = [
    { token: 1, pending: true, patches: [{ kind: 'category', id: 1, values: { estimatedQuantity: 5, unit: 'pcs' } }] },
    { token: 2, pending: true, patches: [{ kind: 'task', id: 1, values: { materialEstimate: 900 } }] },
  ];
  const named = source.categories.map(row => row.id === 1 ? { ...row, name: 'Mobilization' } : row);
  let result = applyEstimateChanges(named, changes);
  assert.equal(result[0].name, 'Mobilization'); assert.equal(result[0].estimatedQuantity, 5);
  assert.equal(result[1].tasks[0].materialEstimate, 900); assert.equal(result[0].categoryMaterialEstimate, 100);
  result = applyEstimateChanges(named, changes.filter(change => change.token !== 2));
  assert.equal(result[1].tasks[0].materialEstimate, 300); assert.equal(result[0].unit, 'pcs');
  assert.equal(result[1].tasks[0].predecessorTaskId, 12);
});

test('unrelated stale refreshes cannot acknowledge a cost save; only confirmed fields retire it', () => {
  const source = fixture();
  const changes = [{ token: 1, pending: true, patches: [{ kind: 'task', id: 11, values: { laborEstimate: 200 } }] }];
  assert.equal(unconfirmedEstimateChanges(plain(source.categories), changes), changes);
  const updated = applyEstimateChanges(source.categories, changes);
  assert.equal(unconfirmedEstimateChanges(updated, changes), changes);
  changes[0].pending = false;
  assert.equal(unconfirmedEstimateChanges(source.categories, changes), changes);
  assert.equal(unconfirmedEstimateChanges(updated, changes).length, 0);
});

test('rapid edits and partial confirmations retire only the saved prefix, including edits back to the original value', () => {
  const source = fixture();
  const changes = [
    { token: 1, pending: false, patches: [{ kind: 'task', id: 11, values: { laborEstimate: 200 } }] },
    { token: 2, pending: true, patches: [{ kind: 'task', id: 11, values: { laborEstimate: 100 } }] },
  ];
  const first = applyEstimatePatches(source.categories, changes[0].patches);
  assert.deepEqual(plain(unconfirmedEstimateChanges(first, changes).map(change => change.token)), [2]);
  assert.equal(unconfirmedEstimateChanges(source.categories, changes), changes);
  changes[1].pending = false;
  assert.equal(unconfirmedEstimateChanges(source.categories, changes).length, 0);
});

test('material/expense line confirmation uses saved content, not generated IDs or extra database metadata', () => {
  const source = fixture();
  const changes = [{ token: 1, pending: false, patches: [{ kind: 'task', id: 11, values: {
    equipmentEstimate: 150, equipmentCostItems: [{ id: -1, costName: 'Truck', amount: 150 }],
  } }] }];
  const updated = applyEstimateChanges(source.categories, changes);
  updated[1].tasks[0].equipmentCostItems = [{ id: 99, costName: 'Truck', amount: 150, quantity: 1 }];
  assert.equal(unconfirmedEstimateChanges(updated, changes).length, 0);
  updated[1].tasks[0].equipmentCostItems[0].costName = 'Other';
  assert.equal(unconfirmedEstimateChanges(updated, changes), changes);
});

test('planned quantity/cost changes recompute percent only from saved work, never from elapsed dates', () => {
  const source = fixture();
  const progress = { task: { 11: { ...calculate.EMPTY_PROGRESS_ANCHOR, cumulativeQuantityCompleted: 5 } }, category: {}, workingDays: [1,2,3,4,5,6], holidays: [] };
  let updated = withSavedEstimateProgress(source.categories, progress);
  assert.equal(updated[1].tasks[0].percentComplete, 50);
  updated = withSavedEstimateProgress(applyEstimatePatches(source.categories, [{ kind: 'task', id: 11, values: { estimatedQuantity: 20 } }]), progress);
  assert.equal(updated[1].tasks[0].percentComplete, 25);
  const noLogs = withSavedEstimateProgress(source.categories.map(row => ({ ...row, plannedStartDate: '2020-01-01', plannedEndDate: '2020-01-02' })), { ...progress, task: {} });
  assert.equal(noLogs[0].percentComplete, 0); assert.equal(noLogs[1].tasks[0].percentComplete, 0);
});

function functionSource(relative, name) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(result, `Missing ${name}`); return result;
}

test('the actual cost quantity handler publishes before the delayed save and rolls back a rejected save', async () => {
  const changes = [], completed = [], rolledBack = []; let reply;
  const handler = functionSource('../../components/projects/cost-estimate/cost-estimate-view.tsx', 'saveEstimatedQuantity');
  const { save } = compile(`${handler}\nexport const save = saveEstimatedQuantity;`, {
    projectId: 7, setSaveError() {}, estimateSync: {
      begin: patches => { changes.push({ token: 1, patches, pending: true }); return 1; },
      complete: token => completed.push(token), rollback: token => rolledBack.push(token),
    }, updateTaskEstimatedQuantity: () => new Promise(resolve => reply = resolve),
  });
  const saving = save({ kind: 'task', id: 11 }, { estimatedQuantity: 25, unit: 'pcs' });
  assert.equal(applyEstimateChanges(fixture().categories, changes)[1].tasks[0].estimatedQuantity, 25);
  reply({ error: 'Edit permission was removed.' }); assert.equal(await saving, false);
  assert.deepEqual(rolledBack, [1]); assert.deepEqual(completed, []);
});

test('the actual equipment/other-cost Save updates shared costs before its delayed action and rolls back on failure', async () => {
  const source = fixture(); const changes = []; const rollbacks = []; let reply;
  const handler = functionSource('../../components/projects/cost-estimate/other-breakdown-modal-content.tsx', 'save');
  const { save } = compile(handler + '\nexport { save };', {
    owners: [{ kind: 'task', id: 11 }], drafts: { 'task-11': [] }, ownerKey: owner => `${owner.kind}-${owner.id}`,
    lines: () => [{ costName: 'Truck', amount: 350 }], inputLine: line => line,
    validOtherCostChanges: () => true, otherCostAmount: line => line.amount,
    costType: 'equipment', projectId: 7, label: 'Equipment', setPending() {}, setError() {}, onClose() {}, router: { refresh() {} },
    estimateSync: { begin: patches => { changes.push({ token: 1, patches, pending: true }); return 1; }, complete() {}, rollback: token => rollbacks.push(token) },
    saveEquipmentCostBreakdown: () => new Promise(resolve => reply = resolve),
  });
  const saving = save();
  assert.equal(applyEstimateChanges(source.categories, changes)[1].tasks[0].equipmentEstimate, 350);
  reply({ error: 'Save failed.' }); await saving; assert.deepEqual(rollbacks, [1]);
});

test('the actual shared provider composes Gantt and cost changes without reflecting its own projection back into Gantt', () => {
  const slots = []; let cursor = 0, dirty = false;
  const hooks = {
    useState(initial) {
      const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (next !== slots[index].value) { slots[index].value = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) { const index = cursor++; const prior = slots[index];
      if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
      const value = fn(); slots[index] = { value, deps }; return value;
    },
  };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  const component = functionSource('../../components/projects/cost-estimate/estimate-sync-context.tsx', 'EstimateSyncProvider');
  const { EstimateSyncProvider } = compile(component, { ...model, ...hooks, Context: { Provider: 'provider' } }, {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
  });
  const estimate = fixture(); const progress = { task: {}, category: {}, workingDays: [1,2,3,4,5,6], holidays: [] };
  function render() { let result, attempts = 0; do { dirty = false; cursor = 0; result = EstimateSyncProvider({ estimate, progress, children: null });
    assert.ok(++attempts < 5, 'Shared estimate caused a render loop'); } while (dirty); return result.props.value; }
  let value = render();
  const projected = estimate.categories.map(category => category.id === 1 ? { ...category, name: 'Renamed from Gantt' } : category);
  value.publishGantt(estimate.categories, projected); value = render();
  assert.equal(value.estimate.categories[0].name, 'Renamed from Gantt');
  assert.equal(value.changes.length, 0);
  const token = value.begin([{ kind: 'task', id: 11, values: { laborEstimate: 500 } }]); value = render();
  assert.equal(value.estimate.categories[0].name, 'Renamed from Gantt');
  assert.equal(value.estimate.categories[1].tasks[0].laborEstimate, 500);
  value.publishGantt(estimate.categories, projected); assert.equal(dirty, false);
  value.rollback(token); value = render();
  assert.equal(value.estimate.categories[1].tasks[0].laborEstimate, 100);
});

test('the actual Gantt override hook retains edits across unrelated cost refreshes and clears only confirmed fields', () => {
  let state = null, dirty = false;
  const hook = functionSource('../../components/projects/progress/gantt-chart-view.tsx', 'usePendingOverrides');
  const { usePendingOverrides: runOverrides } = compile(hook + '\nexport { usePendingOverrides };', {
    EMPTY_OVERRIDES: new Map(),
    useState: () => [state, value => { state = typeof value === 'function' ? value(state) : value; dirty = true; }],
  });
  const confirmed = (rows, id, value) => rows.some(row => row.id === id && row.name === value);
  function render(rows) { let result, count = 0; do { dirty = false; result = runOverrides(rows, confirmed);
    assert.ok(++count < 5); } while (dirty); return result; }
  const original = fixture().categories;
  let [overrides, setOverride] = render(original);
  setOverride(1, 'New name'); [overrides, setOverride] = render(original);
  assert.equal(overrides.get(1), 'New name');
  const staleRefresh = plain(original);
  [overrides, setOverride] = render(staleRefresh);
  assert.equal(overrides.get(1), 'New name');
  setOverride(2, 'Concrete'); [overrides] = render(staleRefresh);
  assert.equal(overrides.get(1), 'New name'); assert.equal(overrides.get(2), 'Concrete');
  const firstConfirmed = staleRefresh.map(row => row.id === 1 ? { ...row, name: 'New name' } : row);
  const [pending, , clear] = render(firstConfirmed);
  assert.equal(pending.has(1), false); assert.equal(pending.get(2), 'Concrete');
  clear(2); assert.equal(render(firstConfirmed)[0].size, 0);
});

test('the actual material Save publishes priced direct/itemized material lines before waiting for the database', async () => {
  const changes = [], completed = []; let reply, closed = false;
  const path = '../../components/projects/cost-estimate/material-breakdown-modal-content.tsx';
  const source = [functionSource(path, 'parseNumber'), functionSource(path, 'toDirectInput'), functionSource(path, 'toLineInput'), functionSource(path, 'handleSave')].join('\n');
  const { save } = compile(source + '\nexport const save = handleSave;', {
    dirtyTaskIds: new Set([11]), dirtyCategoryIds: new Set(), projectId: 7,
    directByTask: { 11: { quantity: '2', unit: 'pcs', unitCost: '100', amountOverride: '' } }, directByCategory: {}, draftByCategory: {}, EMPTY_DIRECT: {},
    draftByTask: { 11: [{ materialName: ' Nails ', specification: '', quantity: '3', unit: 'kg', unitCost: '10', amountOverride: '' }] },
    setError() {}, setPending() {}, router: { refresh() {} }, onClose: () => closed = true,
    estimateSync: { begin: patches => { changes.push({ token: 1, patches, pending: true }); return 1; }, complete: token => completed.push(token), rollback() {} },
    updateTaskMaterialAssignments: () => new Promise(resolve => reply = resolve),
  });
  const saving = save();
  const actual = applyEstimateChanges(fixture().categories, changes)[1].tasks[0];
  assert.equal(actual.materialEstimate, 230); assert.equal(actual.materialDirectQuantity, 2);
  assert.equal(actual.materialAssignments[0].materialName, 'Nails');
  assert.equal(actual.totalEstimateCost, 330);
  assert.equal(closed, false);
  reply({ success: true }); await saving;
  assert.deepEqual(completed, [1]); assert.equal(closed, true);
});

test('labor Save publishes global/per-row amounts immediately and preserves a successful global rate if one row later fails', async () => {
  const changes = [], completed = new Set(), rolledBack = new Set(); let replyRate, replyTask;
  let error, closed = false;
  const path = '../../components/projects/cost-estimate/labor-breakdown-modal-content.tsx';
  const source = functionSource(path, 'parsePercent') + '\n' + functionSource(path, 'handleSave');
  const { save } = compile(source + '\nexport const save = handleSave;', {
    categories: fixture().categories, projectId: 7, projectBase: 750,
    rateDirty: true, ratePercentInput: '10', dirtyTaskIds: new Set([11]), dirtyCategoryIds: new Set(),
    taskPercentDraft: { 11: '20' }, categoryPercentDraft: {},
    setError: value => error = value, setPending() {}, router: { refresh() {} }, onClose: () => closed = true,
    estimateSync: { begin: patches => { const token = changes.length + 1; changes.push({ token, patches, pending: true }); return token; },
      complete: token => completed.add(token), rollback: token => rolledBack.add(token) },
    updateProjectDefaultLaborCostPercent: async () => ({ success: true }),
    applyLaborRateProjectWide: () => new Promise(resolve => replyRate = resolve),
    updateTaskLaborEstimate: (_id, _project, amount) => { assert.equal(amount, 150); return new Promise(resolve => replyTask = resolve); },
  });
  const saving = save();
  let updated = applyEstimateChanges(fixture().categories, changes);
  assert.equal(updated[0].categoryLaborEstimate, 75); assert.equal(updated[1].tasks[0].laborEstimate, 150);
  assert.equal(updated[1].tasks[1].laborEstimate, 75);
  await new Promise(resolve => setImmediate(resolve)); replyRate({ success: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed.has(1), true);
  replyTask({ error: 'Task access changed.' }); await saving;
  assert.equal(rolledBack.has(2), true); assert.equal(rolledBack.has(1), false);
  updated = applyEstimateChanges(fixture().categories, changes.filter(change => !rolledBack.has(change.token)));
  assert.equal(updated[1].tasks[0].laborEstimate, 75);
  assert.equal(error, 'Task access changed.'); assert.equal(closed, false);
});

test('the actual Gantt publication includes inline names, priorities and dates for the cost breakdown', () => {
  const relative = '../../components/projects/progress/gantt-chart-view.tsx';
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'publishedCategories') expression = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(expression);
  const { result } = compile(`export const result = ${expression};`, {
    useMemo: fn => fn(), localCategoriesForDisplay: fixture().categories,
    pendingCategoryNameOverrides: new Map([[1, 'Mobilization']]), pendingCategoryPriorityOverrides: new Map([[1, 'high']]),
    pendingCategoryScheduleOverrides: new Map([[1, { start: '2026-11-01', end: '2026-11-02' }]]),
    pendingNameOverrides: new Map([[11, 'Footings']]), pendingPriorityOverrides: new Map([[11, 'low']]),
    pendingScheduleOverrides: new Map([[11, { start: '2026-11-03', end: '2026-11-05' }]]),
  });
  assert.equal(result[0].name, 'Mobilization'); assert.equal(result[0].priority, 'high'); assert.equal(result[0].plannedStartDate, '2026-11-01');
  assert.equal(result[1].tasks[0].name, 'Footings'); assert.equal(result[1].tasks[0].priority, 'low'); assert.equal(result[1].tasks[0].plannedEndDate, '2026-11-05');
  assert.equal(result[1].tasks[0].materialEstimate, 300);
});

test('Undo and Redo cannot race with an in-flight shared cost save', async () => {
  for (const name of ['handleUndo', 'handleRedo']) {
    const source = functionSource('../../components/projects/progress/gantt-chart-view.tsx', name);
    const { run } = compile(source + `\nexport const run = ${name};`, {
      canEdit: true, deleting: false, savingModalEdit: false, savingRowOrder: false, savingSharedCost: true,
    });
    assert.equal(await run(), undefined);
  }
});
