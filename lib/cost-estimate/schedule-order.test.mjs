import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function compile(source, dependencies = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => dependencies[name], Error });
  return exports;
}
const model = compile(readFileSync(new URL('./schedule-order.ts', import.meta.url), 'utf8'));
const { applyScheduleMove, applyPendingScheduleMoves, scheduleOrderForMove, unconfirmedScheduleMoves } = model;
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = () => [
  { id: 1, name: 'Mobilization', tasks: [], percentComplete: 0, predecessorCategoryId: 3 },
  { id: 2, name: 'Concrete', tasks: [
    { id: 11, categoryId: 2, name: 'Footings', percentComplete: 50, laborEstimate: 300, predecessorTaskId: null },
    { id: 12, categoryId: 2, name: 'Columns', percentComplete: 0, predecessorTaskId: 11 },
    { id: 13, categoryId: 2, name: 'Test', isMilestone: true, plannedEndDate: '2026-11-06' },
  ] },
  { id: 3, name: 'Finish', tasks: [{ id: 21, categoryId: 3, name: 'Paint' }] },
];
const move = (id, targetId, after = false, kind = 'category') => ({ kind, id, targetId, after });

test('main tasks move with their children without mutating progress, dependencies, cost or input data', () => {
  const base = fixture(), original = plain(base);
  const result = applyScheduleMove(base, move(2, 3, true));
  assert.deepEqual(plain(result.map(row => row.id)), [1, 3, 2]);
  assert.equal(result[2], base[1]);
  assert.deepEqual(plain(base), original);
  assert.deepEqual(plain(result[2].tasks), original[1].tasks);
});

test('subtasks, including milestones, can reorder only inside their own main task', () => {
  const base = fixture();
  const result = applyScheduleMove(base, move(13, 11, false, 'task'));
  assert.deepEqual(plain(result[1].tasks.map(row => row.id)), [13, 11, 12]);
  assert.equal(result[0], base[0]);
  assert.equal(scheduleOrderForMove(base, move(11, 21, true, 'task')), null);
  assert.deepEqual(plain(applyScheduleMove(base, move(11, 21, true, 'task'))), plain(base));
  assert.equal(scheduleOrderForMove(base, move(11, 11, false, 'task')), null);
  assert.equal(scheduleOrderForMove(base, move(11, 12, false, 'task')), null);
});

test('saved order survives unrelated stale refreshes, then retires when the saved sibling order arrives', () => {
  const base = fixture();
  const entry = { token: 1, move: move(3, 1), pending: false, savedOrder: { kind: 'category', categoryId: null, ids: [3, 1, 2] } };
  const entries = [entry];
  assert.equal(unconfirmedScheduleMoves(plain(base), entries), entries);
  const updated = applyPendingScheduleMoves(base, entries);
  assert.deepEqual(plain(updated.map(row => row.id)), [3, 1, 2]);
  assert.equal(unconfirmedScheduleMoves(updated, entries).length, 0);
  entry.pending = true;
  assert.equal(unconfirmedScheduleMoves(updated, entries), entries);
});

test('a failed earlier drop can be removed while a later queued move is rebased safely', () => {
  const base = fixture();
  const entries = [
    { token: 1, move: move(3, 1), pending: true },
    { token: 2, move: move(2, 3, true), pending: true },
  ];
  assert.deepEqual(plain(applyPendingScheduleMoves(base, entries).map(row => row.id)), [3, 2, 1]);
  const afterFailure = applyPendingScheduleMoves(base, entries.slice(1));
  assert.deepEqual(plain(afterFailure.map(row => row.id)), [1, 3, 2]);
});

test('confirmation handles rapid inverse moves, added rows and deleted target rows', () => {
  const base = fixture();
  const entries = [
    { token: 1, move: move(3, 1), pending: false, savedOrder: { kind: 'category', categoryId: null, ids: [3, 1, 2] } },
    { token: 2, move: move(3, 2, true), pending: false, savedOrder: { kind: 'category', categoryId: null, ids: [1, 2, 3] } },
  ];
  assert.equal(unconfirmedScheduleMoves(base, entries).length, 0);
  const added = [...base, { id: 4, name: 'New', tasks: [] }];
  assert.equal(unconfirmedScheduleMoves(added, entries).length, 0);
  assert.equal(unconfirmedScheduleMoves(base.filter(row => row.id !== 3), entries).length, 0);
});

// Exercise the actual UI save handler against delayed and failed server actions.
const ganttSource = readFileSync(new URL('../../components/projects/progress/gantt-chart-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('gantt.tsx', ganttSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleRowMove') handler = node.getText(ast); ts.forEachChild(node, visit); }
visit(ast);
assert.ok(handler);
function uiFixture(overrides = {}) {
  const state = { moves: [], error: null }, calls = [], replies = [], refreshes = [];
  const context = {
    canEdit: true, deleting: false, isUndoRedoPending: false, projectId: 7, categoriesForDisplay: fixture(),
    rowMoveSequence: { current: 0 }, rowMoveQueue: { current: Promise.resolve() }, scheduleOrderForMove,
    setRowMoveError: value => state.error = value, setRowMoves: fn => state.moves = fn(state.moves),
    moveScheduleRow: (...args) => { calls.push(args); return new Promise(resolve => replies.push(resolve)); },
    router: { refresh: () => refreshes.push(true) }, ...overrides,
  };
  const { bind } = compile(`export function bind(context) {
    const { canEdit, deleting, isUndoRedoPending, projectId, categoriesForDisplay, rowMoveSequence, rowMoveQueue,
      scheduleOrderForMove, setRowMoveError, setRowMoves, moveScheduleRow, router } = context;
    ${handler}; return handleRowMove;
  }`);
  return { change: bind(context), state, context, calls, replies, refreshes };
}

test('drop immediately reorders both row/bar input data before any server response', async () => {
  const f = uiFixture(); f.change(move(3, 1));
  assert.equal(f.state.moves.length, 1);
  assert.deepEqual(plain(applyPendingScheduleMoves(fixture(), f.state.moves).map(row => row.id)), [3, 1, 2]);
  assert.equal(f.calls.length, 0);
  await Promise.resolve();
  f.replies.shift()({ order: { kind: 'category', categoryId: null, ids: [3, 1, 2] } });
  await f.context.rowMoveQueue.current;
  assert.equal(f.state.moves[0].pending, false);
  assert.equal(f.refreshes.length, 1);
});

test('rapid drops save serially; an error removes only its move and later drops still save', async () => {
  const f = uiFixture(); f.change(move(3, 1)); f.change(move(1, 3, true));
  assert.equal(f.state.moves.length, 2);
  await Promise.resolve(); assert.equal(f.calls.length, 1);
  f.replies.shift()({ error: 'Access changed.' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 2); assert.equal(f.state.moves.length, 1);
  assert.equal(f.state.error, 'Access changed.');
  f.replies.shift()({ order: { kind: 'category', categoryId: null, ids: [2, 3, 1] } });
  await f.context.rowMoveQueue.current;
  assert.equal(f.state.moves[0].pending, false);
});

test('read-only, temporary, no-op and undo-in-flight rows never submit reorder mutations', () => {
  for (const options of [{ canEdit: false }, { deleting: true }, { isUndoRedoPending: true }]) {
    const f = uiFixture(options); f.change(move(3, 1)); assert.equal(f.state.moves.length, 0);
  }
  const f = uiFixture(); f.change(move(-1, 1)); f.change(move(1, 1)); f.change(move(1, 2));
  assert.equal(f.state.moves.length, 0);
});

const actionSource = readFileSync(new URL('./reorder-actions.ts', import.meta.url), 'utf8');
function actionFixture({ authorized = true, error = null } = {}) {
  const calls = [], events = [];
  const { moveScheduleRow } = compile(actionSource, {
    '@/lib/auth/project-access': { requireProjectAccess: async projectId => { calls.push(['access', projectId]); return authorized ? { id: 'pm' } : null; } },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (name, args) => {
      calls.push([name, plain(args)]); return { data: { category_id: null, ids: [3, 1, 2] }, error };
    } }) },
    '@/lib/projects/revalidate': { revalidateProjectPaths: () => events.push('refresh') },
    './undo-redo': { recordGanttCheckpoint: async () => events.push('checkpoint') },
  });
  return { save: moveScheduleRow, calls, events };
}
test('server action verifies edit access, scopes the transaction and checkpoints successful reorders', async () => {
  const f = actionFixture(); const result = await f.save(7, move(3, 1));
  assert.deepEqual(plain(result.order), { kind: 'category', categoryId: null, ids: [3, 1, 2] });
  assert.deepEqual(f.calls, [['access', 7], ['move_estimate_row', { p_project_id: 7, p_kind: 'category', p_row_id: 3, p_target_id: 1, p_after: false }]]);
  assert.deepEqual(f.events, ['checkpoint', 'refresh']);
});
test('server action rejects denied access and invalid input without writes; missing migration has a clear error', async () => {
  const denied = actionFixture({ authorized: false }); assert.ok((await denied.save(7, move(3, 1))).error);
  assert.equal(denied.calls.length, 1); assert.deepEqual(denied.events, []);
  const invalid = actionFixture(); assert.ok((await invalid.save(7, move(-3, 1))).error); assert.deepEqual(invalid.calls, []);
  const missing = actionFixture({ error: { code: 'PGRST202' } });
  assert.match((await missing.save(7, move(3, 1))).error, /0107/); assert.deepEqual(missing.events, []);
});
