import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./gantt-chart-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('gantt.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found;
  function visit(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found); return found;
}
function compile(body, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, ...globals });
  return exports;
}
const tableRows = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'tableRows').initializer.getText(ast);
const rowAccent = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'rowAccent').initializer.getText(ast);
const row = find(node => ts.isJsxOpeningElement(node) && node.attributes.properties.some(prop =>
  ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'data-gantt-order-row'));
const rowKey = row.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'key').initializer.expression.getText(ast);
const clientKey = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'clientRowKey').getText(ast);
const { ganttBarColors } = compile(readFileSync(new URL('./gantt-bar-colors.ts', import.meta.url), 'utf8'));
const { visible, key, accent } = compile(`
  ${clientKey}
  exports.visible = (rows, categoryById, taskById) => ${tableRows};
  exports.key = (row, category, task) => {
    const rowKind = category ? 'category' : 'task';
    const savedRowId = category?.id ?? task?.id ?? 0;
    return ${rowKey};
  };
  exports.accent = (category, task, isFiller = false, isMilestoneRow = false) => {
    const isGroup = Boolean(category?.hasTasks);
    return ${rowAccent};
  };`, {
  clientRowKeys: { current: new Map([['category:100', 'category:-1'], ['task:200', 'task:-2']]) },
  FILLER_ROW_ID_PREFIX: 'filler-', ganttBarColors,
});

test('bulk deletion filters all stale task rows while keeping distinct filler rows', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1) }));
  rows.push({ id: 'filler-0' }, { id: 'filler-1' });
  const filtered = visible(rows, new Map(), new Map());
  assert.deepEqual(Array.from(filtered, row => row.id), ['filler-0', 'filler-1']);
  const keys = filtered.map(row => key(row));
  assert.equal(new Set(keys).size, keys.length);
});

test('partial deletions preserve surviving rows, their order, and their keys', () => {
  const rows = [{ id: 'phase-1' }, { id: '11' }, { id: '12' }, { id: '13' }, { id: 'filler-0' }];
  const category = { id: 1 }, task = { id: 12, categoryId: 1 };
  const categories = new Map([['phase-1', category]]), tasks = new Map([['12', task]]);
  const filtered = visible(rows, categories, tasks);
  assert.deepEqual(Array.from(filtered, row => row.id), ['phase-1', '12', 'filler-0']);
  assert.equal(key(rows[2], undefined, task), 'task:12');
  assert.equal(new Set(filtered.map(row => key(row, categories.get(row.id), tasks.get(row.id)))).size, 3);
});

test('missing records use distinct actual row IDs rather than the shared task:0 key', () => {
  const keys = ['21', '22', 'phase-9', 'filler-0', 'filler-1'].map(id => key({ id }));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every(value => value !== 'task:0'));
});

test('a creation keeps its row key when its temporary ID is replaced by the saved ID', () => {
  assert.equal(key({ id: 'phase--1' }, { id: -1 }), key({ id: 'phase-100' }, { id: 100 }));
  assert.equal(key({ id: '-2' }, undefined, { id: -2 }), key({ id: '200' }, undefined, { id: 200 }));
  assert.notEqual(key({ id: 'phase-100' }, { id: 100 }), key({ id: '200' }, undefined, { id: 200 }));
});

test('the group strip matches the main bar and continues through its subtasks', () => {
  for (const id of [1, 2, 15, 100]) {
    const expected = ganttBarColors(id, 'summary').backgroundColor;
    assert.equal(accent({ id, hasTasks: true }), expected);
    assert.equal(accent(undefined, { categoryId: id }), expected);
    assert.equal(accent(undefined, { categoryId: id }, false, true), expected);
  }
  assert.equal(accent({ id: 1, hasTasks: false }), ganttBarColors(1, 'standalone').backgroundColor);
  assert.equal(accent({ id: 1, hasTasks: false }, undefined, false, true), ganttBarColors(1, 'milestone').backgroundColor);
  assert.equal(accent(undefined, undefined, true), undefined);
});
