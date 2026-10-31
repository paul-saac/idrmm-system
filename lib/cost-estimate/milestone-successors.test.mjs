import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const plain = value => JSON.parse(JSON.stringify(value));
function compile(relative, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: name => mocks[name], FormData, console: { error() {} } });
  return exports;
}
const options = compile('./successor-options.ts');
const modal = compile('../../components/projects/progress/schedule-modal-edits.ts');
const fixture = () => [
  { id: 1, name: 'Start', isMilestone: true, tasks: [] },
  { id: 2, name: 'Concrete', isMilestone: false, tasks: [
    { id: 1, name: 'Footings', isMilestone: false, predecessorTaskId: null, totalEstimateCost: 500, percentComplete: 40 },
    { id: 2, name: 'Columns', isMilestone: false, predecessorTaskId: 1 },
    { id: 3, name: 'Inspection', isMilestone: true, predecessorTaskId: null },
  ] },
  { id: 3, name: 'Finishing', isMilestone: false, tasks: [{ id: 4, name: 'Paint', predecessorTaskId: null }] },
  { id: 4, name: 'Permit', isMilestone: false, tasks: [] },
];
function form(values) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }

test('a milestone lists all saved main tasks and subtasks in the project, excluding itself and temporary rows', () => {
  const categories = fixture(); categories.push({ id: -1, name: 'Saving', tasks: [] });
  let result = options.projectSuccessorOptions(categories, { kind: 'category', id: 1 }, true);
  assert.equal(result.length, 7);
  assert.ok(result.some(row => options.scheduleRowKey(row) === 'task:1'));
  assert.ok(result.some(row => row.kind === 'category' && row.id === 2));
  assert.ok(result.some(row => row.name === 'Finishing / Paint'));
  assert.ok(!result.some(row => row.kind === 'category' && row.id === 1));
  assert.ok(!result.some(row => row.id < 0));
  result = options.projectSuccessorOptions(categories, { kind: 'task', id: 3 }, true);
  assert.equal(result.length, 7);
  assert.ok(!result.some(row => row.kind === 'task' && row.id === 3));
});

test('regular task choices retain the existing sibling/standalone scope', () => {
  assert.deepEqual(plain(options.projectSuccessorOptions(fixture(), { kind: 'task', id: 1 }, false).map(options.scheduleRowKey)), ['task:2', 'task:3']);
  assert.deepEqual(plain(options.projectSuccessorOptions(fixture(), { kind: 'category', id: 1 }, false).map(options.scheduleRowKey)), ['category:4']);
});

test('main-task milestone -> subtask updates immediately without confusing overlapping numeric IDs or changing costs/progress', () => {
  const base = fixture(), original = plain(base);
  base[3].predecessorCategoryId = 1;
  const edit = modal.scheduleModalEdit('category', 1, form({ categoryName: 'Start', milestoneField: '1', isMilestone: 'on', successorRowKey: 'task:1' }));
  const result = modal.applyScheduleModalEdits(base, [edit]);
  assert.equal(result[1].tasks[0].predecessorCategoryId, 1);
  assert.equal(result[1].tasks[0].predecessorTaskId, null);
  assert.equal(result[0].predecessorCategoryId, undefined);
  assert.equal(result[3].predecessorCategoryId, null);
  assert.equal(result[1].tasks[0].totalEstimateCost, original[1].tasks[0].totalEstimateCost);
  assert.equal(result[1].tasks[0].percentComplete, 40);
});

test('subtask milestone -> main task or another group is immediate, reversible and confirmed only by the matching server links', () => {
  const base = fixture(); base[1].tasks[1].predecessorTaskId = 3;
  const edit = modal.scheduleModalEdit('task', 3, form({ isMilestone: 'on', successorRowKey: 'category:4' }));
  const entry = { token: 1, edit, pending: false };
  const result = modal.applyScheduleModalEdits(base, [edit]);
  assert.equal(result[3].predecessorTaskId, 3); assert.equal(result[3].predecessorCategoryId, null);
  assert.equal(result[1].tasks[1].predecessorTaskId, null);
  assert.equal(modal.unconfirmedScheduleModalEdits(base, [entry]).length, 1);
  assert.equal(modal.unconfirmedScheduleModalEdits(result, [entry]).length, 0);
  const clear = modal.scheduleModalEdit('task', 3, form({ isMilestone: 'on', successorRowKey: '' }));
  assert.equal(modal.applyScheduleModalEdits(result, [clear])[3].predecessorTaskId, null);
});

test('server actions submit typed successor references through the atomic RPC after checking project access', async () => {
  const calls = [], events = [];
  const client = { rpc: async (name, args) => { calls.push([name, plain(args)]); return { error: null }; } };
  const actions = compile('./actions.ts', {
    '@/lib/projects/revalidate': { revalidateProjectPaths: () => events.push('refresh') },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/auth/project-access': { requireProjectAccess: async () => ({ id: 'pm' }) },
    '@/lib/cost-estimate/undo-redo': { recordGanttCheckpoint: async () => events.push('checkpoint') }, './other-cost-lines': {},
  });
  assert.equal((await actions.updateCategory(1, 7, {}, form({ categoryName: 'Start', milestoneField: '1', isMilestone: 'on', successorRowKey: 'task:4' }))).success, true);
  assert.equal(calls[0][0], 'save_estimate_successor'); assert.equal(calls[0][1].p_source_kind, 'category');
  assert.equal(calls[0][1].p_successor_kind, 'task'); assert.equal(calls[0][1].p_successor_id, 4);
  assert.equal(calls[0][1].p_milestone, true);
  assert.equal((await actions.updateSubtask(3, 7, {}, form({ isMilestone: 'on', successorRowKey: 'category:4' }))).success, true);
  assert.equal(calls[1][1].p_source_kind, 'task'); assert.equal(calls[1][1].p_successor_kind, 'category');
  assert.deepEqual(events, ['checkpoint', 'refresh', 'checkpoint', 'refresh']);
  assert.ok((await actions.updateSubtask(3, 7, {}, form({ successorRowKey: 'other:3' }))).error);
  assert.equal(calls.length, 2);
});

test('checking Milestone immediately expands each actual edit form to all project rows; unchecking clears an incompatible selection', () => {
  const categories = fixture();
  for (const kind of ['category','task']) {
    const states = []; let cursor = 0;
    const react = { useEffect() {}, useId: () => 'form', useActionState: (_action, initial) => [initial, () => {}, false],
      useState(initial) { const index = cursor++; if (!states[index]) states[index] = { value: typeof initial === 'function' ? initial() : initial };
        return [states[index].value, value => states[index].value = typeof value === 'function' ? value(states[index].value) : value]; } };
    const noop = () => {};
    const component = compile(kind === 'task' ? '../../components/projects/progress/subtask-form.tsx' : '../../components/projects/cost-estimate/category-form.tsx', {
      react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
      'next/navigation': { useRouter: () => ({ refresh() {} }) }, 'lucide-react': { Check: 'check', ChevronDown: 'chevron', Trash2: 'trash' },
      '@/components/ui/required-mark': { RequiredMark: 'required' }, '@/components/ui/empty-state': { EmptyState: 'empty' },
      '@/components/ui/modal': { ModalFooter: 'footer' },
      '@/lib/cost-estimate/successor-options': options,
      '@/lib/cost-estimate/actions': { createTask: noop, updateSubtask: noop, createCategory: noop, updateCategory: noop, deleteCategory: noop },
    });
    const render = () => { cursor = 0; return kind === 'task'
      ? component.SubtaskForm({ projectId: 7, categoryId: 2, task: { ...categories[1].tasks[0], materialAssignments: [] }, siblingTasks: categories[1].tasks, projectCategories: categories })
      : component.CategoryForm({ projectId: 7, category: { ...categories[0], hasTasks: false, isMilestone: false }, projectCategories: categories }); };
    function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]; }
    let tree = render();
    let select = nodes(tree).find(node => node.type === 'select');
    assert.equal(nodes(select).filter(node => node.type === 'option').length, kind === 'task' ? 3 : 2);
    nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    tree = render(); select = nodes(tree).find(node => node.type === 'select');
    assert.equal(select.props.name, 'successorRowKey');
    assert.equal(nodes(select).filter(node => node.type === 'option').length, 8);
    select.props.onChange({ target: { value: kind === 'task' ? 'category:4' : 'task:4' } });
    tree = render();
    assert.equal(nodes(tree).find(node => node.type === 'select').props.value, kind === 'task' ? 'category:4' : 'task:4');
    nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
    tree = render();
    assert.equal(nodes(tree).find(node => node.type === 'select').props.value, '');
  }
});
