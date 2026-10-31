import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => dependencies[name] ?? require(name),
    requestAnimationFrame: run => { run(); return 1; }, CSS: { escape: value => value }, crypto });
  return exports;
}
function descendants(element, predicate) {
  const found = [];
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!React.isValidElement(node)) return;
    if (predicate(node)) found.push(node);
    visit(node.props.children);
  }
  visit(element); return found;
}
function fixture() {
  const state = []; let cursor = 0, nextId = 0, confirmations = 0;
  let categories = [
    { id: 'a', name: 'Mobilization', amount: '5000', tasks: [] },
    { id: 'b', name: 'Earthworks', amount: '', tasks: [
      { id: 'task', name: 'Excavation', quantity: '10', unit: 'cu.m', materials: [
        { id: 'mat', name: 'Gravel', quantity: '2', unit: 'cu.m', unitCost: '100' },
      ] },
    ] },
    { id: 'c', name: 'Electrical', amount: '', tasks: [] },
  ];
  const hooks = { ...React, useEffect() {}, useRef: value => ({ current: value }), useId: () => `test-${++nextId}`,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
  };
  function FilterMenu() { return React.createElement('div'); }
  const shared = load('./breakdown-table-shared.tsx');
  const { ImportBomDraftReview } = load('./import-bom-draft-review.tsx', {
    react: hooks, './breakdown-table-shared': shared, '@/components/ui/view-menu': { ViewMenu: FilterMenu },
  });
  let tree;
  const render = () => {
    cursor = 0;
    tree = ImportBomDraftReview({ categories, onChange: change => { categories = change(categories); },
      onBack() {}, onConfirm: () => confirmations++, error: null });
    return tree;
  };
  const find = predicate => { const nodes = descendants(tree, predicate); assert.ok(nodes.length); return nodes[0]; };
  const select = name => { find(node => node.type === 'button' && node.props.title === name).props.onClick(); render(); };
  const selected = () => descendants(tree, node => node.type === 'tr' && node.props['data-draft-category']).map(node => node.props['data-draft-category']);
  render();
  return { render, find, select, selected, get data() { return categories; }, get confirmations() { return confirmations; },
    html: () => renderToStaticMarkup(tree), filter: value => { find(node => node.type === FilterMenu).props.onChange(value); render(); } };
}

test('the outline shows exactly the selected standalone item or main task and its descendants', () => {
  const f = fixture();
  assert.deepEqual(f.selected(), ['a']);
  assert.equal(descendants(f.render(), node => node.props.label === 'Task name').length, 0);
  f.select('Earthworks');
  assert.deepEqual(f.selected(), ['b']);
  assert.equal(f.find(node => node.props.label === 'Task name').props.value, 'Excavation');
  assert.equal(f.find(node => node.props.label === 'Material name').props.value, 'Gravel');
  assert.equal(f.data.length, 3);
});

test('search and missing-field filters select an eligible item rather than hiding the outline result', () => {
  const f = fixture();
  f.find(node => node.type === 'input' && node.props['aria-label'] === 'Find a category, task or material').props.onChange({ target: { value: 'Gravel' } });
  f.render(); assert.deepEqual(f.selected(), ['b']);
  f.filter('missing'); // Search remains active, and this group has no missing data.
  assert.deepEqual(f.selected(), []);
  f.find(node => node.type === 'input' && node.props['aria-label'] === 'Find a category, task or material').props.onChange({ target: { value: '' } });
  f.render(); assert.deepEqual(f.selected(), ['c']);
});

test('task quantity editing is separate from material quantities and preserves hidden draft items', () => {
  const f = fixture(); f.select('Earthworks');
  const menu = f.find(node => node.type?.name === 'RowMenu' && node.props.name === 'Excavation');
  menu.props.actions.find(action => action.label === 'Task quantity & unit').run(); f.render();
  f.find(node => node.props.label === 'Task quantity for Excavation').props.onChange('25'); f.render();
  f.find(node => node.props.label === 'Material quantity for Gravel').props.onChange('3'); f.render();
  assert.equal(f.data[1].tasks[0].quantity, '25');
  assert.equal(f.data[1].tasks[0].materials[0].quantity, '3');
  assert.equal(f.data[0].amount, '5000');
  assert.equal(f.data[2].name, 'Electrical');
  f.find(node => node.type === 'button' && node.props.onClick && node.props.children?.[1] === 'Confirm & create tasks').props.onClick();
  assert.equal(f.confirmations, 1);
});

test('deleting the selected draft item safely selects the next remaining item', () => {
  const f = fixture();
  f.find(node => node.type?.name === 'RowMenu' && node.props.name === 'Mobilization').props.actions.find(action => action.label === 'Delete category').run();
  f.render(); assert.deepEqual(f.selected(), ['b']); assert.equal(f.data.length, 2);
});

test('the rendered table keeps the material headers, tree columns, and right-hand row menus', () => {
  const f = fixture(); f.select('Earthworks'); const html = f.html();
  for (const label of ['Task', 'Material Quantity', 'Unit Cost', 'Amount']) assert.match(html, new RegExp(`>${label}</th>`));
  assert.doesNotMatch(html, /Unit cost \(₱\)|Amount \(₱\)/);
  assert.match(html, /colSpan="5"/i);
  assert.match(html, /Manage Earthworks/); assert.match(html, /Manage Excavation/); assert.match(html, /Manage Gravel/);
});
