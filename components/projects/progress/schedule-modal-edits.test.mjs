import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const modelSource = readFileSync(new URL('./schedule-modal-edits.ts', import.meta.url), 'utf8');
function compile(source, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: name => dependencies[name], FormData, Error, ...globals });return exports;
}
const { applyScheduleModalEdits, scheduleModalEdit, unconfirmedScheduleModalEdits } = compile(modelSource);
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = () => [
  { id: 1, name: 'Mobilization', tasks: [], isMilestone: false, predecessorCategoryId: 3, categoryLaborEstimate: 100, plannedStartDate: '2026-10-30', percentComplete: 20 },
  { id: 2, name: 'Clearing', tasks: [], isMilestone: false, predecessorCategoryId: 1 },
  { id: 3, name: 'Other', tasks: [], isMilestone: false, predecessorCategoryId: null },
  { id: 4, name: 'Concrete Works', isMilestone: false, tasks: [
    { id: 11, name: 'Footings', isMilestone: false, predecessorTaskId: 13, laborEstimate: 500, plannedEndDate: '2026-11-05', percentComplete: 50, priority: 'high' },
    { id: 12, name: 'Columns', isMilestone: false, predecessorTaskId: 11 },
    { id: 13, name: 'Slab', isMilestone: false, predecessorTaskId: null },
  ] },
];
function form(values) { const f = new FormData();for (const [key, value] of Object.entries(values)) f.set(key, value);return f; }

test('main task milestone and successor change immediately without changing actual work, costs or dates', () => {
  const base = fixture();const original = plain(base);
  const edit = scheduleModalEdit('category', 1, form({ categoryName: 'Mobilization', milestoneField: '1', isMilestone: 'on', successorCategoryId: '3' }));
  const result = applyScheduleModalEdits(base, [edit]);
  assert.equal(result[0].isMilestone, true);assert.equal(result[0].predecessorCategoryId, 3);
  assert.equal(result[1].predecessorCategoryId, null);assert.equal(result[2].predecessorCategoryId, 1);
  assert.equal(result[0].categoryLaborEstimate, 100);assert.equal(result[0].percentComplete, 20);assert.equal(result[0].plannedStartDate, '2026-10-30');
  assert.deepEqual(plain(base), original);
});
test('subtask update changes the milestone and successor only, preserving its own predecessor and all other fields', () => {
  const base = fixture();const edit = scheduleModalEdit('task', 11, form({ isMilestone: 'on', successorTaskId: '13' }));
  const result = applyScheduleModalEdits(base, [edit]);const tasks = result[3].tasks;
  assert.equal(tasks[0].isMilestone, true);assert.equal(tasks[0].predecessorTaskId, 13);
  assert.equal(tasks[1].predecessorTaskId, null);assert.equal(tasks[2].predecessorTaskId, 11);
  for (const key of ['name', 'laborEstimate', 'plannedEndDate', 'percentComplete', 'priority']) assert.equal(tasks[0][key], base[3].tasks[0][key]);
});
test('unchecked milestones and empty successor selections clear exposed fields; omitted inputs preserve them', () => {
  const base = fixture();base[0].isMilestone = true;
  let result = applyScheduleModalEdits(base, [scheduleModalEdit('category', 1, form({ categoryName: 'Mobilization' }))]);
  assert.equal(result[0].isMilestone, true);assert.equal(result[1].predecessorCategoryId, 1);
  result = applyScheduleModalEdits(base, [scheduleModalEdit('category', 1, form({ milestoneField: '1', successorCategoryId: '' }))]);
  assert.equal(result[0].isMilestone, false);assert.equal(result[1].predecessorCategoryId, null);
});
test('an unrelated stale refresh never removes an in-flight or unconfirmed edit', () => {
  const base = fixture();const entry = { token: 1, edit: { kind: 'category', id: 1, isMilestone: true }, pending: true };
  const pending = [entry];assert.equal(unconfirmedScheduleModalEdits(plain(base), pending), pending);
  entry.pending = false;assert.equal(unconfirmedScheduleModalEdits(plain(base), pending), pending);
  const confirmed = applyScheduleModalEdits(base, [entry.edit]);assert.equal(unconfirmedScheduleModalEdits(confirmed, pending).length, 0);
  assert.equal(unconfirmedScheduleModalEdits([], pending), pending);
});
test('rapid saves that replace a relationship or undo a milestone are reconciled as one confirmed result', () => {
  const base = fixture();const entries = [
    { token: 1, edit: { kind: 'category', id: 1, isMilestone: true, successorId: 3 }, pending: false },
    { token: 2, edit: { kind: 'category', id: 1, isMilestone: false, successorId: 2 }, pending: false },
  ];
  const final = applyScheduleModalEdits(base, entries.map(e => e.edit));
  assert.equal(unconfirmedScheduleModalEdits(final, entries).length, 0);
  entries[1].pending = true;assert.ok(unconfirmedScheduleModalEdits(base, entries).length > 0);
});

const ganttSource = readFileSync(new URL('./gantt-chart-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('gantt.tsx', ganttSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleModalSave') handler = node.getText(ast);ts.forEachChild(node, visit); }
visit(ast);assert.ok(handler);
function saveFixture() {
  const state = { edits: [], error: null, categoryModal: { id: 1 }, taskModal: { id: 11 } };
  const calls = [], resolvers = [], refreshes = [];
  const context = {
    canEdit: true, projectId: 7, modalEditSequence: { current: 0 }, modalSaveQueue: { current: Promise.resolve() },
    setModalSaveError: value => state.error = value,
    setModalEdits: fn => state.edits = fn(state.edits),
    setCategoryModal: value => state.categoryModal = value, setTaskModal: value => state.taskModal = value,
    updateCategory: id => { calls.push(['category', id]);return new Promise(resolve => resolvers.push(resolve)); },
    updateSubtask: id => { calls.push(['task', id]);return new Promise(resolve => resolvers.push(resolve)); },
    router: { refresh: () => refreshes.push(true) }, scheduleModalEdit,
  };
  const { bind } = compile(`export function bind(context) { const { canEdit, projectId, modalEditSequence, modalSaveQueue,
    setModalSaveError, setModalEdits, setCategoryModal, setTaskModal, updateCategory, updateSubtask, router, scheduleModalEdit } = context;
    ${handler}; return handleModalSave; }`);
  return { save: bind(context), state, context, calls, resolvers, refreshes };
}
test('Save closes the modal and patches the chart before the delayed server response', async () => {
  const f = saveFixture();f.save('category', 1, 'Mobilization', form({ milestoneField: '1', isMilestone: 'on' }));
  assert.equal(f.state.categoryModal, null);assert.equal(f.state.edits[0].pending, true);
  assert.equal(applyScheduleModalEdits(fixture(), f.state.edits.map(e => e.edit))[0].isMilestone, true);
  await Promise.resolve();assert.deepEqual(f.calls, [['category', 1]]);
  f.resolvers.shift()({ success: true });await f.context.modalSaveQueue.current;
  assert.equal(f.state.edits[0].pending, false);assert.equal(f.refreshes.length, 1);
});
test('background edits save in click order; failures roll back their patch, report the error and allow queued saves', async () => {
  const f = saveFixture();f.save('task', 11, 'Footings', form({ isMilestone: 'on' }));
  f.save('category', 1, 'Mobilization', form({ milestoneField: '1', isMilestone: 'on' }));
  await Promise.resolve();assert.deepEqual(f.calls, [['task', 11]]);
  f.resolvers.shift()({ error: 'Edit access was removed.' });
  // The second queued operation begins only after the first has settled.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, [['task', 11], ['category', 1]]);
  assert.equal(f.state.edits.length, 1);assert.match(f.state.error, /Footings.*Edit access was removed/);
  f.resolvers.shift()({ success: true });await f.context.modalSaveQueue.current;
  assert.equal(f.state.edits[0].pending, false);assert.equal(f.refreshes.length, 2);
});
test('both edit forms intercept submission only for the parent-owned edit save; normal create actions remain available', () => {
  for (const relative of ['./subtask-form.tsx', '../cost-estimate/category-form.tsx']) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const parsed = ts.createSourceFile('form.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression;
    function find(node) {
      if (ts.isJsxAttribute(node) && node.name.getText(parsed) === 'onSubmit' && node.initializer.expression.getText(parsed).includes('onSave'))
        expression = node.initializer.expression.getText(parsed);
      ts.forEachChild(node, find);
    }
    find(parsed);assert.ok(expression);
    class FormDataStub { constructor(element) { this.element = element; } }
    const { intercept } = compile(`export function intercept(category,isEdit,onSave){return (${expression});}`, {}, { FormData: FormDataStub });
    let submitted, prevented = false;
    const onSubmit = intercept({ id: 1 }, true, data => submitted = data);
    const element = {};onSubmit({ currentTarget: element, preventDefault: () => prevented = true });
    assert.equal(prevented, true);assert.equal(submitted.element, element);
    assert.equal(intercept(undefined, false, () => {}), undefined);
    assert.equal(intercept({ id: 1 }, true, undefined), undefined);
  }
});
