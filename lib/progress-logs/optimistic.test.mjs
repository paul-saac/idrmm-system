import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function compile(path, dependencies = {}, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => dependencies[name] ?? {}, Date, Map, Set, console, ...globals });
  return exports;
}
const calc = {
  COST_COMPONENTS: ['labor', 'material', 'equipment', 'other'],
  EMPTY_PROGRESS_ANCHOR: { cumulativeQuantityCompleted: 0, cumulativeMaterialUsage: {}, cumulativeCosts: { labor: 0, material: 0, equipment: 0, other: 0 }, loggedDates: [] },
  materialKey: (name, unit) => `${name}|${unit}`, otherCostKey: name => name.toLowerCase(),
};
const model = compile('./optimistic.ts', { '@/lib/task-progress/calculate': calc });
const plain = value => JSON.parse(JSON.stringify(value));
const today = '2026-11-02';
function log(date = today, quantity = 10, id = 1, labor = 100) {
  return { id, action: 'saved', entryDate: date, createdAt: `${date}T08:00:00.000Z`, savedByName: 'Tester', savedByRole: 'Super Administrator',
    quantityCompleted: quantity, costs: { labor, material: 0, equipment: 20, other: 5 }, materialsUsed: [{ name: 'Sand', unit: 'cu.m', quantity: 2 }],
    attendance: [{ workerId: 42, name: 'Worker', hours: 1, rate: labor }], equipmentCosts: [{ name: 'Truck', amount: 20 }], otherCosts: [{ name: 'Permit', amount: 5 }] };
}
test('first save projects recorded quantity, usage, costs, attendance and history without altering its source', () => {
  const source = plain(calc.EMPTY_PROGRESS_ANCHOR);
  const result = model.projectProgressLog(undefined, [], today, log(), today);
  assert.equal(result.progress.cumulativeQuantityCompleted, 10);
  assert.equal(result.progress.cumulativeCosts.labor, 100);
  assert.equal(result.progress.cumulativeMaterialUsage['Sand|cu.m'], 2);
  assert.equal(result.progress.todayAttendance[0].workerName, 'Worker');
  assert.equal(result.progress.todayAttendance[0].workerId, 42);
  assert.deepEqual(plain(result.progress.loggedDates), [today]);
  assert.equal(result.history.length, 1);
  assert.deepEqual(plain(calc.EMPTY_PROGRESS_ANCHOR), source);
});
test('resaving replaces that day once; removing it removes every resave while retaining earlier days', () => {
  const older = log('2026-11-01', 4, 1, 50);
  const first = model.projectProgressLog(undefined, [], older.entryDate, older, today);
  const second = model.projectProgressLog(first.progress, first.history, today, log(today, 10, 2), today);
  const before = plain(second.progress);
  const replacement = { ...log(today, 15, -3, 150), createdAt: `${today}T09:00:00.000Z` };
  const saved = model.projectProgressLog(second.progress, second.history, today, replacement, today);
  assert.equal(saved.progress.cumulativeQuantityCompleted, 19);
  assert.equal(saved.progress.cumulativeCosts.labor, 200);
  assert.equal(saved.progress.cumulativeMaterialUsage['Sand|cu.m'], 4);
  assert.deepEqual(plain(second.progress), before);
  const removed = model.projectProgressLog(saved.progress, saved.history, today, null, today);
  assert.equal(removed.progress.cumulativeQuantityCompleted, 4);
  assert.equal(removed.progress.cumulativeCosts.labor, 50);
  assert.equal(removed.history.length, 1);
  assert.equal(removed.progress.today, null);
  assert.equal(removed.progress.latest.entryDate, '2026-11-01');
});
test('deleting an older log preserves today and does not substitute automatic progress', () => {
  const old = log('2026-11-01', 5);
  const first = model.projectProgressLog(undefined, [], old.entryDate, old, today);
  const second = model.projectProgressLog(first.progress, first.history, today, log(today, 10, 2), today);
  const removed = model.projectProgressLog(second.progress, second.history, old.entryDate, null, today);
  assert.equal(removed.progress.cumulativeQuantityCompleted, 10);
  assert.equal(removed.progress.today.quantityCompleted, 10);
  assert.equal(removed.progress.latest.entryDate, today);
  const empty = model.projectProgressLog(removed.progress, removed.history, today, null, today);
  assert.equal(empty.progress.cumulativeQuantityCompleted, 0);
  assert.equal(empty.progress.cumulativeCosts.labor, 0);
  assert.equal(empty.progress.latest, null);
});
test('unplanned material quantity is not double counted as planned usage or purchase expense', () => {
  const entry = log(); entry.materialsUsed.push({ name: 'Extra', unit: 'bag', quantity: 3, unitCost: 50 });
  const saved = model.projectProgressLog(undefined, [], today, entry, today);
  assert.equal(saved.progress.cumulativeUnplannedMaterialCost, 150);
  assert.equal(saved.progress.cumulativeCosts.material, 0);
  assert.equal(saved.progress.cumulativeMaterialUsage['Extra|bag'], undefined);
  const removed = model.projectProgressLog(saved.progress, saved.history, today, null, today);
  assert.equal(removed.progress.cumulativeUnplannedMaterialCost, 0);
});
function providerFixture() {
  const slots = []; let cursor = 0, dirty = false, effects = [], refreshes = 0;
  const context = {};
  const hooks = {
    createContext: () => context, useContext: () => context.value,
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; const old = slots[i]; if (old && deps.every((d, j) => Object.is(d, old.deps[j]))) return old.value;
      const value = fn(); slots[i] = { deps, value }; return value; },
    useEffect(fn) { cursor++; effects.push(fn); },
  };
  const { ProgressLogSyncProvider } = compile('../../components/projects/progress/progress-log-sync.tsx', {
    react: hooks, 'next/navigation': { useRouter: () => ({ refresh() { refreshes++; } }) },
    '@/lib/progress-logs/optimistic': model,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  });
  let props = { task: {}, category: {}, history: {} };
  function render(next = props) { props = next; let tree, count = 0;
    do { cursor = 0; dirty = false; effects = []; tree = ProgressLogSyncProvider({ ...props, children: null }); assert.ok(++count < 8); } while (dirty);
    for (const effect of effects) effect(); context.value = tree.props.value;
    return tree.props.value;
  }
  return { render, refreshes: () => refreshes };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('provider updates before a delayed save, blocks duplicate same-task saves, and rolls back permission failures', async () => {
  const f = providerFixture(); let resolve;
  let value = f.render();
  assert.equal(value.run({ kind: 'task', id: 1 }, today, log(), () => new Promise(r => resolve = r)), true);
  value = f.render();
  assert.equal(value.task[1].cumulativeQuantityCompleted, 10);
  assert.equal(value.history['task-1'].length, 1);
  assert.equal(value.run({ kind: 'task', id: 1 }, today, log(), () => assert.fail('Duplicate save')), false);
  resolve({ error: 'Permission removed' }); await tick();
  value = f.render();
  assert.equal(value.task[1], undefined);
  assert.equal(value.history['task-1'], undefined);
  assert.equal(f.refreshes(), 1);
});
test('unrelated stale refresh cannot clear a pending or completed save; canonical history releases its lock', async () => {
  const f = providerFixture(); let resolve;
  let value = f.render();
  value.run({ kind: 'category', id: 1 }, today, log(), () => new Promise(r => resolve = r));
  value = f.render({ task: {}, category: {}, history: { 'category-1': [] } });
  assert.equal(value.category[1].cumulativeQuantityCompleted, 10);
  resolve({ success: true }); await tick();
  value = f.render(); assert.equal(value.category[1].cumulativeQuantityCompleted, 10);
  const canonical = { ...value.category[1], cumulativeCosts: { labor: 125, material: 0, equipment: 20, other: 5 } };
  value = f.render({ task: {}, category: { 1: canonical }, history: { 'category-1': [log(today, 10, 999, 125)] } });
  assert.equal(value.category[1].cumulativeCosts.labor, 125);
  assert.equal(value.run({ kind: 'category', id: 1 }, today, null, async () => ({ success: true })), true);
  assert.equal(f.render().category[1].cumulativeQuantityCompleted, 0);
  await tick();
});
test('different tasks can save concurrently and one failure does not roll back the other', async () => {
  const f = providerFixture(); const replies = [];
  let value = f.render();
  value.run({ kind: 'task', id: 1 }, today, log(), () => new Promise(resolve => replies.push(resolve)));
  value = f.render();
  value.run({ kind: 'task', id: 2 }, today, log(today, 20), () => new Promise(resolve => replies.push(resolve)));
  replies[0]({ error: 'Failed' }); replies[1]({ success: true }); await tick();
  value = f.render(); assert.equal(value.task[1], undefined); assert.equal(value.task[2].cumulativeQuantityCompleted, 20);
});


test('a thrown save failure clears its projection so the task can be retried', async () => {
  const f = providerFixture(); let value = f.render();
  value.run({ kind: 'task', id: 1 }, today, log(), async () => { throw new Error('Network lost'); });
  await tick(); value = f.render(); assert.equal(value.task[1], undefined);
  assert.equal(value.run({ kind: 'task', id: 1 }, today, log(), async () => ({ success: true })), true);
  await tick();
});

test('a successful deletion is immediate and reconciles with the remaining authoritative logs', async () => {
  const f = providerFixture(); const entry = log();
  const initial = model.projectProgressLog(undefined, [], today, entry, today);
  let resolve;
  let value = f.render({ task: { 1: initial.progress }, category: {}, history: { 'task-1': initial.history } });
  value.run({ kind: 'task', id: 1 }, today, null, () => new Promise(r => resolve = r));
  value = f.render(); assert.equal(value.history['task-1'].length, 0); assert.equal(value.task[1].cumulativeQuantityCompleted, 0);
  const removed = value.task[1];
  resolve({ success: true }); await tick();
  value = f.render({ task: { 1: removed }, category: {}, history: {} });
  assert.equal(value.run({ kind: 'task', id: 1 }, today, entry, async () => ({ success: true })), true);
  await tick();
});
