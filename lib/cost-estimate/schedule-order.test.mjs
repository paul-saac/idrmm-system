import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const plain = value => JSON.parse(JSON.stringify(value));
function compile(snippet, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(snippet, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: name => mocks[name] });
  return exports;
}
const { scheduleOrderForMove, applyPendingScheduleMoves } = compile(
  readFileSync(new URL('./schedule-order.ts', import.meta.url), 'utf8'));

const fixture = () => [
  { id: 1, name: 'Phase 1', tasks: [{ id: 11, name: 'Task 11' }, { id: 12, name: 'Task 12' }] },
  { id: 2, name: 'Phase 2', tasks: [{ id: 21, name: 'Task 21' }, { id: 22, name: 'Task 22' }, { id: 23, name: 'Task 23' }] },
  { id: 3, name: 'Phase 3', tasks: [] },
];
const move = (sourceId, targetId, after = false, kind = 'category', parentId = null) => ({
  source: { kind, id: sourceId, parentId }, target: { kind, id: targetId, parentId }, after,
});

test('main tasks move with their children without mutating progress, dependencies, cost or input data', () => {
  const base = fixture(), original = plain(base);
  const result = scheduleOrderForMove(base, move(3, 1));
  assert.equal(result.kind, 'category');
  assert.equal(result.categoryId, null);
  assert.deepEqual(result.ids, [3, 1, 2]);
  assert.deepEqual(plain(base), original);
  const after = scheduleOrderForMove(base, move(1, 2, true));
  assert.deepEqual(after.ids, [2, 1, 3]);
});

test('subtasks, including milestones, can reorder only inside their own main task', () => {
  const base = fixture();
  const result = scheduleOrderForMove(base, move(23, 21, false, 'task', 2));
  assert.equal(result.kind, 'task');
  assert.equal(result.categoryId, 2);
  assert.deepEqual(result.ids, [23, 21, 22]);
  const cross = scheduleOrderForMove(base, move(11, 21, false, 'task', 1));
  assert.equal(cross, null);
});

test('saved order survives unrelated stale refreshes, then retires when the saved sibling order arrives', () => {
  const base = fixture();
  const pending = [{ token: 1, move: move(3, 1), pending: true }];
  let display = applyPendingScheduleMoves(base, pending);
  assert.deepEqual(display.map(row => row.id), [3, 1, 2]);
  // A background poll returns the old order with a new cost or name edit.
  const staleRefresh = [
    { ...base[0], name: 'Phase 1 renamed' },
    base[1], base[2],
  ];
  display = applyPendingScheduleMoves(staleRefresh, pending);
  assert.deepEqual(display.map(row => row.id), [3, 1, 2]);
  assert.equal(display[1].name, 'Phase 1 renamed');
  // When the reorder lands and clears pending, confirmation matching the order retires it.
  pending[0].pending = false;
  assert.deepEqual(applyPendingScheduleMoves(staleRefresh, pending).map(row => row.id), [3, 1, 2]);
  const confirmed = [base[2], base[0], base[1]];
  assert.deepEqual(applyPendingScheduleMoves(confirmed, pending).map(row => row.id), [3, 1, 2]);
});

test('a failed earlier drop can be removed while a later queued move is rebased safely', () => {
  const base = fixture();
  const pending = [
    { token: 1, move: move(3, 1), pending: true },
    { token: 2, move: move(1, 3, true), pending: true },
  ];
  let display = applyPendingScheduleMoves(base, pending);
  assert.deepEqual(display.map(row => row.id), [3, 1, 2]);
  // Move 1 failed; remove it. Move 2 now applies cleanly on base.
  pending.shift();
  display = applyPendingScheduleMoves(base, pending);
  assert.deepEqual(display.map(row => row.id), [2, 3, 1]);
});

test('confirmation handles rapid inverse moves, added rows and deleted target rows', () => {
  const base = fixture();
  const pending = [
    { token: 1, move: move(3, 1), pending: true },
    { token: 2, move: move(3, 2, true), pending: true },
  ];
  let display = applyPendingScheduleMoves(base, pending);
  assert.deepEqual(display.map(row => row.id), [1, 2, 3]);
  const added = [...base, { id: 4, name: 'Phase 4', tasks: [] }];
  display = applyPendingScheduleMoves(added, pending);
  assert.deepEqual(display.map(row => row.id), [1, 2, 3, 4]);
  const deleted = [base[0], base[2]];
  display = applyPendingScheduleMoves(deleted, [pending[1]]);
  assert.deepEqual(display.map(row => row.id), [1, 3]);
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
    router: { refresh: () => refreshes.push(true) }, queueEdit: op => op(), ...overrides,
  };
  const { bind } = compile(`export function bind(context) {
    const { canEdit, deleting, isUndoRedoPending, projectId, categoriesForDisplay, rowMoveSequence, rowMoveQueue,
      scheduleOrderForMove, setRowMoveError, setRowMoves, moveScheduleRow, router, queueEdit } = context;
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
  for (const override of [
    { canEdit: false }, { deleting: true }, { isUndoRedoPending: true },
    { categoriesForDisplay: [{ id: -1, name: 'Temp', tasks: [] }] },
  ]) {
    const f = uiFixture(override); f.change(move(3, 1));
    assert.equal(f.state.moves.length, 0);
    assert.equal(f.calls.length, 0);
  }
  const noop = uiFixture(); noop.change(move(1, 1));
  assert.equal(noop.state.moves.length, 0);
});

test('server action verifies edit access, scopes the transaction and checkpoints successful reorders', async () => {
  const calls = [], checkpoints = [], revalidations = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: [3, 1, 2], error: null }; } };
  const { moveScheduleRow } = compile(readFileSync(new URL('./schedule-actions.ts', import.meta.url), 'utf8'), {
    '@/lib/auth/project-access': { requireProjectAccess: async () => ({ id: 'pm' }) },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/cost-estimate/undo-redo': { recordGanttCheckpoint: async () => checkpoints.push(true) },
    '@/lib/projects/revalidate': { revalidateProjectPaths: () => revalidations.push(true) },
  });
  const result = await moveScheduleRow(7, { kind: 'category', categoryId: null, ids: [3, 1, 2] });
  assert.deepEqual(result, { order: { kind: 'category', categoryId: null, ids: [3, 1, 2] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'reorder_estimate_rows');
  assert.deepEqual(calls[0][1], { p_project_id: 7, p_kind: 'category', p_category_id: null, p_ids: [3, 1, 2] });
  assert.equal(checkpoints.length, 1);
  assert.equal(revalidations.length, 1);
});

test('server action rejects denied access and invalid input without writes; missing migration has a clear error', async () => {
  const client = { rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) };
  const { moveScheduleRow } = compile(readFileSync(new URL('./schedule-actions.ts', import.meta.url), 'utf8'), {
    '@/lib/auth/project-access': { requireProjectAccess: async id => id === 7 ? { id: 'pm' } : null },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/cost-estimate/undo-redo': { recordGanttCheckpoint: async () => {} },
    '@/lib/projects/revalidate': { revalidateProjectPaths: () => {} },
  });
  assert.match((await moveScheduleRow(9, { kind: 'category', categoryId: null, ids: [1] })).error, /not authorized/);
  assert.match((await moveScheduleRow(7, { kind: 'category', categoryId: null, ids: [] })).error, /Reorder list cannot be empty/);
  assert.match((await moveScheduleRow(7, { kind: 'category', categoryId: null, ids: [1] })).error, /migration 0109/);
});
