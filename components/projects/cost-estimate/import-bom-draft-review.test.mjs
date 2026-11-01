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
    react: hooks, './estimate-row-menu': load('./estimate-row-menu.tsx', { react: hooks }), '@/lib/bom-import/estimate-resources': load('../../../lib/bom-import/estimate-resources.ts'), './breakdown-table-shared': shared, '@/components/ui/view-menu': { ViewMenu: FilterMenu },
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
  assert.deepEqual(f.selected(), ['a', 'b', 'c']);
  assert.equal(descendants(f.render(), node => node.type === 'button' && node.props['aria-current'] === 'location').length, 0);
  f.select('Mobilization');
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

test('material quantity remains editable without task quantity controls', () => {
  const f = fixture(); f.select('Earthworks');
  const menu = f.find(node => node.type?.name === 'RowMenu' && node.props.name === 'Excavation');
  assert.equal(menu.props.actions.some(action => action.label === 'Task quantity & unit'), false);
  f.find(node => node.props.label === 'Material quantity for Gravel').props.onChange('3'); f.render();
  assert.equal(f.data[1].tasks[0].quantity, '10');
  assert.equal(f.data[1].tasks[0].materials[0].quantity, '3');
  assert.equal(f.data[0].amount, '5000');
  assert.equal(f.data[2].name, 'Electrical');
  f.find(node => node.type === 'button' && node.props.onClick && node.props.children?.[1] === 'Confirm & create tasks').props.onClick();
  assert.equal(f.confirmations, 1);
});

test('clicking the selected outline item again restores all tasks', () => {
  const f = fixture(); f.select('Earthworks');
  assert.deepEqual(f.selected(), ['b']);
  f.select('Earthworks');
  assert.deepEqual(f.selected(), ['a', 'b', 'c']);
  assert.equal(descendants(f.render(), node => node.props['aria-current'] === 'location').length, 0);
  assert.doesNotMatch(f.html(), />\?<\/td>/);
});

test('missing materials stay highlighted without warning icons beside task names', () => {
  const f = fixture();
  f.data[1].tasks[0].materials[0].unitCost = '';
  f.render(); f.select('Earthworks');
  assert.equal(f.find(node => node.props.label === 'Unit cost for Gravel').props.missing, true);
  // Only the overall warning banner has an alert icon; task rows do not.
  assert.equal((f.html().match(/lucide-triangle-alert/g) || []).length, 1);
});

test('deleting the selected outline item returns to all remaining items without selecting another', () => {
  const f = fixture(); f.select('Earthworks');
  f.find(node => node.type?.name === 'RowMenu' && node.props.name === 'Earthworks').props.actions.find(action => action.label === 'Delete category').run();
  f.render(); assert.deepEqual(f.selected(), ['a', 'c']); assert.equal(f.data.length, 2);
  assert.equal(descendants(f.render(), node => node.type === 'button' && node.props['aria-current'] === 'location').length, 0);
});

test('clicking a table row does not activate the outline filter', () => {
  const f = fixture();
  f.find(node => node.type === 'tr' && node.props['data-draft-category'] === 'a').props.onClick();
  f.render(); assert.deepEqual(f.selected(), ['a', 'b', 'c']);
  assert.equal(descendants(f.render(), node => node.type === 'button' && node.props['aria-current'] === 'location').length, 0);
});

test('the table has only Task and Amount headers with material fields labeled inside the row', () => {
  const f = fixture(); f.select('Earthworks'); const html = f.html();
  for (const label of ['Item No.', 'Task', 'Amount']) assert.match(html, new RegExp(`>${label}</th>`));
  assert.doesNotMatch(html, /Unit cost \(₱\)|Amount \(₱\)/);
  assert.match(html, /colSpan="2"/i);
  assert.doesNotMatch(html, />(?:Material Quantity|Quantity|Unit|Unit Cost)<\/th>/);
  for (const label of ['Material', 'Quantity', 'Unit', 'Unit Cost']) assert.match(html, new RegExp(`>${label}</span>`));
  assert.match(html, /Manage Earthworks/); assert.match(html, /Manage Excavation/); assert.match(html, /Manage Gravel/);
  assert.doesNotMatch(html, /<span[^>]*>\?<\/span>/);
});

test('reviewing equipment, labor and other costs edits the draft and updates its total', () => {
  const f=fixture();f.select('Earthworks');
  const action=label=>{f.find(node=>node.type?.name==='RowMenu' && node.props.name==='Excavation').props.actions.find(action=>action.label===label).run();f.render();};
  action('Add equipment cost');
  f.find(node=>node.props.label==='Equipment name').props.onChange('Mixer');f.render();
  f.find(node=>node.props.label==='Amount for Mixer').props.onChange('500');f.render();
  action('Add other cost');
  f.find(node=>node.props.label==='Other cost name').props.onChange('Permit');f.render();
  f.find(node=>node.props.label==='Amount for Permit').props.onChange('150');f.render();
  action('Add labor amount');
  f.find(node=>node.props.label==='Labor amount for Excavation').props.onChange('1000');f.render();
  assert.equal(f.data[1].tasks[0].equipment[0].amount,'500');
  assert.equal(f.data[1].tasks[0].otherCosts[0].amount,'150');
  assert.equal(f.data[1].tasks[0].laborEstimate,'1000');
  assert.match(f.html(),/6,850/); // 5,000 standalone + 200 materials + 1,650 new costs.
  assert.doesNotMatch(f.html(),/Import steps|Review &amp; edit|Project data/);
});

test('adding a first subtask preserves standalone resource costs by moving them into that subtask',()=>{
  const f=fixture();f.select('Mobilization');
  f.find(node=>node.type?.name==='RowMenu' && node.props.name==='Mobilization').props.actions.find(action=>action.label==='Add task').run();f.render();
  assert.equal(f.data[0].amount,'');
  assert.equal(f.data[0].tasks[0].amount,'5000');
  assert.match(f.html(),/5,200/);
});

test('footer add controls create only the selected resource rows with description and amount',()=>{
  const f=fixture();f.select('Earthworks');
  assert.doesNotMatch(f.html(),/Direct planned cost|Planned labor/);
  assert.equal(descendants(f.render(),node=>node.props['data-resource-kind']==='equipment').length,0);
  f.find(node=>node.type==='button' && node.props.children==='+ Add equipment').props.onClick();f.render();
  assert.equal(f.data[1].tasks[0].equipment.length,1);
  const equipment=f.find(node=>node.props['data-resource-kind']==='equipment');
  assert.equal(descendants(equipment,node=>node.props.label==='Equipment name').length,1);
  assert.equal(descendants(equipment,node=>node.props.label==='Amount for equipment').length,1);
  assert.equal(descendants(equipment,node=>node.type==='label').length,1);
  f.find(node=>node.type==='button' && node.props.children==='+ Add other').props.onClick();f.render();
  assert.equal(f.data[1].tasks[0].otherCosts.length,1);
  const other=f.find(node=>node.props['data-resource-kind']==='otherCosts');
  assert.equal(descendants(other,node=>node.props.label==='Other cost name').length,1);
  assert.equal(descendants(other,node=>node.props.label==='Amount for other cost').length,1);
  const material=f.find(node=>node.props['data-resource-kind']==='material');
  assert.equal(descendants(material,node=>node.type==='label').length,4);
});

test('footer additions work for standalone tasks and preserve their original amounts',()=>{
  const f=fixture();f.select('Mobilization');
  f.find(node=>node.type==='button' && node.props.children==='+ Add other').props.onClick();f.render();
  assert.equal(f.data[0].otherCosts.length,1);
  assert.equal(f.data[0].tasks.length,0);
  assert.equal(f.data[0].amount,'5000');
  assert.doesNotMatch(f.html(),/Direct amount for Mobilization/);
  assert.match(f.html(),/5,200/);
});

test('clicking a resource row targets its task for footer additions, even after selecting another task',()=>{
  const f=fixture();
  f.data[1].tasks.push({id:'second',name:'Second task',quantity:'',unit:'',materials:[]});f.render();
  const second=f.find(node=>node.type==='tr' && descendants(node,cell=>cell.props.label==='Task name' && cell.props.value==='Second task').length>0);
  second.props.onClick();f.render();
  f.find(node=>node.props['data-resource-kind']==='material').props.onClick();f.render();
  f.find(node=>node.type==='button' && node.props.children==='+ Add equipment').props.onClick();f.render();
  assert.equal(f.data[1].tasks[0].equipment.length,1);
  assert.equal(f.data[1].tasks[1].equipment,undefined);
});

test('task amounts are preserved without repeating the task name in an extra cost row',()=>{
  const f=fixture();
  f.data[1].tasks[0].amount='9600';f.render();f.select('Earthworks');
  assert.match(f.html(),/9,800/);
  assert.equal(f.data[1].tasks[0].amount,'9600');
  assert.equal(descendants(f.render(),node=>node.props.label==='Direct amount for Excavation').length,0);
  assert.equal(descendants(f.render(),node=>node.props.label==='Task name' && node.props.value==='Excavation').length,1);
  const material=f.find(node=>node.props['data-resource-kind']==='material');
  const fields=descendants(material,node=>node.type==='label');
  assert.equal(descendants(fields[0],node=>node.type==='span' && node.props.children==='Material').length,1);
  for(const field of fields.slice(1)) {
    assert.match(field.props.className,/flex.*items-center/);
    assert.equal(field.props.children[0].type,'span');
    assert.match(field.props.children[0].props.className,/text-zinc-400/);
    assert.equal(field.props.children[1].type.name,'Cell');
  }
});

test('source item numbers stay editable and new resource rows have blank numbers and descriptive placeholders',()=>{
  const f=fixture();
  f.data[1].itemNo='IV.'; f.data[1].tasks[0].itemNo='IV-02';
  f.data[1].tasks[0].materials[0].itemNo='02.01';f.render();f.select('Earthworks');
  assert.equal(f.find(node=>node.props.label==='Item number for Earthworks').props.value,'IV.');
  assert.equal(f.find(node=>node.props.label==='Item number for Excavation').props.value,'IV-02');
  f.find(node=>node.props.label==='Item number for material Gravel').props.onChange('A.01');f.render();
  assert.equal(f.data[1].tasks[0].materials[0].itemNo,'A.01');
  for(const [button,kind,label,placeholder] of [
    ['+ Add material','material','Material name','Material description'],
    ['+ Add equipment','equipment','Equipment name','Equipment description'],
    ['+ Add other','otherCosts','Other cost name','Other cost description'],
  ]) {
    f.find(node=>node.type==='button' && node.props.children===button).props.onClick();f.render();
    const row=descendants(f.render(),node=>node.props['data-resource-kind']===kind).at(-1);
    const field=descendants(row,node=>node.props.label===label)[0];
    assert.equal(field.props.placeholder,placeholder);assert.equal(field.props.value,'');
    const number=descendants(row,node=>node.props.label?.startsWith?.('Item number for'))[0];
    assert.equal(number.props.value,'');
    const cells=row.props.children.filter(child=>child?.type==='td');
    assert.match(cells[2].props.className,/border-l-3 border-l-zinc-300/);
    assert.doesNotMatch(cells[2].props.className,/pl-[46]/);
  }
});

test('printed material amounts can be corrected without inventing quantities or rates',()=>{
  const f=fixture();
  const material=f.data[1].tasks[0].materials[0];
  material.quantity='';material.unitCost='';material.amount='9600';f.render();f.select('Earthworks');
  f.find(node=>node.props.label==='Amount for material Gravel').props.onChange('9800');f.render();
  assert.equal(f.data[1].tasks[0].materials[0].amount,'9800');
  assert.equal(f.data[1].tasks[0].materials[0].quantity,'');
  assert.equal(f.data[1].tasks[0].materials[0].unitCost,'');
  assert.match(f.html(),/9,800/);
});
