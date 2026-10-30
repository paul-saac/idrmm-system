import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the real asynchronous handlers with deferred server responses.
const source = await readFile(new URL("../components/projects/progress/gantt-chart-view.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("gantt.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
function handler(name, dependencies) {
  const js = ts.transpileModule(`const handler = ${functions.get(name)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn handler;`)(...Object.values(dependencies));
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(kind) {
  const response = deferred();
  const state = { editing: null, row: null, error: null, writes: [], overrides: [] };
  const edit = next => { state.editing = typeof next === "function" ? next(state.editing) : next; };
  const dependencies = {
    canEdit: true, isAddingPhase: false, activeNewTask: null, projectId: 1, categories: [],
    phaseRowId: handler("phaseRowId", {}), setCollapsedPhaseIds: () => {},
    ZERO_COSTS: { labor: 0, material: 0, equipment: 0, other: 0 },
    pendingNameCreations: { current: new Map() }, inlineNameDrafts: { current: new Map() },
    setScheduleError: value => { state.error = value; }, setAddingPhaseAt: () => {},
    setPendingNewPhase: value => { state.row = value; }, setPendingNewTask: value => { state.row = value; },
    setEditingCategoryId: edit, setEditingTaskId: edit,
    setCategoryNameOverride: (id, value) => state.overrides.push({ id, value }),
    setNameOverride: (id, value) => state.overrides.push({ id, value }),
    clearCategoryNameOverride: () => {}, clearNameOverride: () => {},
    createCategory: () => response.promise, createTask: () => response.promise,
    updateCategory: async (id, project, previous, form) => { state.writes.push({ id, value: form.get("categoryName") }); return {}; },
    renameTask: async (id, project, value) => { state.writes.push({ id, value }); return {}; },
    router: { refresh() {} },
  };
  return { response, state, dependencies, add: handler(kind === "category" ? "handleAddPhase" : "handleAddSubtask", dependencies), rename: handler(kind === "category" ? "handleCategoryRename" : "handleTaskRename", dependencies) };
}

for (const kind of ["category", "task"]) {
  test(`${kind}: name editor opens before the server responds and preserves the draft/caret`, async () => {
    const f = fixture(kind);
    const pending = f.add(9);
    const temporary = f.state.editing;
    assert.ok(temporary < 0, "the optimistic row must already be editable");
    const draft = { value: "Concrete work", start: 13, end: 13 };
    f.dependencies.inlineNameDrafts.current.set(`${kind}:${temporary}`, draft);
    f.response.resolve(kind === "category" ? { categoryId: 44 } : { taskId: 44 });
    await pending;
    assert.equal(f.state.editing, 44);
    assert.deepEqual(f.dependencies.inlineNameDrafts.current.get(`${kind}:44`), draft);
    assert.deepEqual(f.state.overrides.at(-1), { id: 44, value: "Concrete work" });
  });
  test(`${kind}: finishing the name while creation is pending saves to the real ID without reopening the editor`, async () => {
    const f = fixture(kind);
    const pending = f.add(9);
    const temporary = f.state.editing;
    const saving = f.rename(temporary, "Roof framing", "New Task");
    assert.equal(f.state.editing, null);
    assert.deepEqual(f.state.writes, []);
    f.response.resolve(kind === "category" ? { categoryId: 55 } : { taskId: 55 });
    await Promise.all([pending, saving]);
    assert.equal(f.state.editing, null);
    assert.deepEqual(f.state.writes, [{ id: 55, value: "Roof framing" }]);
  });
  test(`${kind}: failed creation removes the optimistic editor and does not rename an invalid ID`, async () => {
    const f = fixture(kind);
    const pending = f.add(9);
    const saving = f.rename(f.state.editing, "New name", "New Task");
    f.response.resolve({ error: "Save failed" });
    await Promise.all([pending, saving]);
    assert.equal(f.state.row, null);
    assert.equal(f.state.editing, null);
    assert.equal(f.state.error, "Save failed");
    assert.deepEqual(f.state.writes, []);
  });
}
