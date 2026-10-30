import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the actual handlers and display selectors with a deferred save.
const source = await readFile(new URL("../components/projects/progress/gantt-chart-view.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("gantt.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) expressions.set(node.name.text, node.getText(ast));
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) expressions.set(node.name.text, node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
function evaluate(name, dependencies) {
  assert.ok(expressions.has(name), `Missing source expression: ${name}`);
  const js = ts.transpileModule(`const value = ${expressions.get(name)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn value;`)(...Object.values(dependencies));
}
const categories = [
  { id: 1, tasks: [{ id: 11 }, { id: 12 }] },
  { id: 2, tasks: [{ id: 21 }] },
];
function fixture(kind, items) {
  let resolve, reject;
  const response = new Promise((done, fail) => { resolve = done; reject = fail; });
  const state = { optimisticDeletions: [], pendingDelete: null, deleting: false, error: null, closed: 0, refreshes: 0, writes: 0, newPhase: null, newTask: null };
  const request = { kind, items, close: () => state.closed++, remove: () => { state.writes++; return response; } };
  state.pendingDelete = request;
  const setter = key => value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const dependencies = {
    pendingDelete: request, canEdit: true, deleting: false,
    setDeleting: setter("deleting"), setDeleteError: setter("error"),
    setPendingDelete: setter("pendingDelete"), setOptimisticDeletions: setter("optimisticDeletions"),
    setPendingNewPhase: setter("newPhase"), setPendingNewTask: setter("newTask"),
    router: { refresh: () => state.refreshes++ },
  };
  const selectors = (serverCategories = categories, override = null) => {
    const values = { categories: serverCategories, activeCategoriesOverride: override, activeNewPhase: state.newPhase?.category ?? null, activeNewTask: state.newTask, optimisticDeletions: state.optimisticDeletions, useMemo: compute => compute() };
    const activeDeletions = evaluate("activeDeletions", values);
    return { activeDeletions, rows: evaluate("categoriesForDisplay", { ...values, activeDeletions }) };
  };
  return { state, request, dependencies, resolve, reject, selectors, run: () => evaluate("runPendingDelete", dependencies)() };
}

for (const [kind, items, expected] of [
  ["task", { taskIds: [11], categoryIds: [] }, [{ id: 1, tasks: [{ id: 12 }] }, categories[1]]],
  ["phase", { taskIds: [], categoryIds: [1] }, [categories[1]]],
  ["selection", { taskIds: [11], categoryIds: [2] }, [{ id: 1, tasks: [{ id: 12 }] }]],
]) {
  test(`${kind}: confirmed rows disappear before save, remain hidden through refresh, and reconcile on success`, async () => {
    const f = fixture(kind, items);
    const saving = f.run();
    assert.deepEqual(f.selectors().rows, expected);
    assert.equal(f.state.pendingDelete, null);
    assert.equal(f.state.closed, kind === "selection" ? 0 : 1);
    assert.deepEqual(f.selectors(structuredClone(categories)).rows, expected, "an unrelated refresh must not reveal pending rows");
    f.resolve({ success: true });
    await saving;
    assert.deepEqual(f.selectors().rows, expected, "stale props stay masked until refreshed");
    assert.equal(f.state.deleting, false);
    assert.equal(f.state.refreshes, 1);
    assert.deepEqual(f.selectors(expected).activeDeletions, [], "the mask expires only after the server confirms absence");
    assert.equal(f.selectors(expected, categories).activeDeletions.length, 1, "a stale Undo override must also stay masked");
  });
  test(`${kind}: rejected save restores rows and opens a retryable error`, async () => {
    const f = fixture(kind, items);
    const saving = f.run();
    f.resolve({ error: "Delete denied" });
    await saving;
    assert.deepEqual(f.selectors().rows, categories);
    assert.equal(f.state.error, "Delete denied");
    assert.equal(f.state.pendingDelete, f.request);
    assert.equal(f.state.deleting, false);
  });
}

test("network failure restores rows and clears the saving lock", async () => {
  const f = fixture("task", { taskIds: [11], categoryIds: [] });
  const saving = f.run();
  f.reject(new Error("Connection lost"));
  await saving;
  assert.deepEqual(f.selectors().rows, categories);
  assert.equal(f.state.error, "Connection lost");
  assert.equal(f.state.deleting, false);
});

test("read-only or already-saving sessions do not issue deletes", async () => {
  for (const blocked of [{ canEdit: false }, { deleting: true }]) {
    const f = fixture("task", { taskIds: [11], categoryIds: [] });
    Object.assign(f.dependencies, blocked);
    await f.run();
    assert.equal(f.state.writes, 0);
    assert.deepEqual(f.selectors().rows, categories);
  }
});

test("deleting a newly created row clears its optimistic creation after save", async () => {
  const f = fixture("task", { taskIds: [99], categoryIds: [] });
  f.state.newTask = { categoryId: 1, task: { id: 99 } };
  const saving = f.run();
  assert.deepEqual(f.selectors().rows, categories);
  f.resolve({ success: true });
  await saving;
  assert.equal(f.state.newTask, null);
  assert.deepEqual(f.selectors().rows, categories);
});

test("calendar event deletion retains its existing confirmation flow", async () => {
  const f = fixture("event");
  const saving = f.run();
  assert.equal(f.state.pendingDelete, f.request);
  assert.deepEqual(f.state.optimisticDeletions, []);
  f.resolve({ success: true });
  await saving;
  assert.equal(f.state.pendingDelete, null);
  assert.equal(f.state.closed, 1);
});
