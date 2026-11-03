import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function load(file, require = () => ({})) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  runInNewContext(code, {exports, require, console, Set, Date, document: {getElementById: () => null}});
  return exports;
}
const validation = load('lib/equipment-requests/validation.ts');
const validItem = {id: 12, equipmentName: 'Concrete Mixer', quantityNeeded: 2, uom: 'units', purpose: 'Slab pouring', quantityFulfilled: 1};
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = value => value == null ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);

function mount(request) {
  const state = []; let cursor = 0;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], value => {state[slot] = typeof value === 'function' ? value(state[slot]) : value;}];
    },
    useActionState: () => [{}, () => {}, false], useId: () => 'equipment-form', useEffect() {},
  };
  const {EquipmentRequestEditForm: Form} = load('components/projects/equipment/equipment-request-edit-form.tsx', name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props})};
    if (name.endsWith('/validation')) return validation;
    if (name.endsWith('/units')) return {OTHER_UNIT: 'other', UNIT_OPTIONS: ['units', 'pcs']};
    if (name.endsWith('/actions')) return {createEquipmentRequest() {}, updateEquipmentRequest() {}};
    return {};
  });
  const render = () => {cursor = 0; return Form({open: true, onClose() {}, projectId: 1, currentUserName: 'Trisha Bravo', request});};
  const find = predicate => nodes(render()).find(predicate);
  return {
    render, find,
    add: () => find(n => n.type === 'button' && text(n) === 'Add item').props.onClick(),
    change: (suffix, value) => find(n => n.props?.id === `equipment-form-${suffix}`).props.onChange({target: {value}}),
    items: () => JSON.parse(find(n => n.props?.name === 'items').props.value),
  };
}

test('Add item appends inline immediately; removing a card preserves other values and custom units', () => {
  const form = mount();
  form.change('item-0-name', 'Concrete Mixer');
  form.add(); form.add();
  assert.equal(form.items().length, 3);
  assert.equal(form.items()[0].equipmentName, 'Concrete Mixer');
  form.change('item-1-name', 'Scaffold');
  form.change('item-1-uom', 'other');
  form.find(n => n.props?.['aria-label'] === 'Custom unit').props.onChange({target: {value: 'sets'}});
  form.find(n => n.props?.['aria-label'] === 'Remove item').props.onClick();
  assert.equal(form.items().length, 2);
  assert.equal(form.items()[0].equipmentName, 'Scaffold');
  assert.equal(form.items()[0].uom, 'sets');
  assert.equal(form.find(n => n.props?.['aria-label'] === 'Custom unit').props.value, 'sets');
});

test('editing preserves item identity and fulfillment, with submit linked to the footer form', () => {
  const form = mount({id: 1, erNo: 'ER-001', requestDate: '2026-11-04', dateRequired: '2026-11-10', priority: 'urgent', items: [validItem]});
  assert.equal(form.items()[0].id, 12);
  assert.equal(form.items()[0].quantityFulfilled, 1);
  assert.equal(form.find(n => n.props?.id === 'equipment-form-item-0-fulfilled').props.value, '1');
  assert.equal(form.find(n => n.props?.type === 'submit').props.form, 'equipment-form');
});

test('incomplete cards report the exact field; complete and custom-unit equipment items pass', () => {
  assert.equal(validation.equipmentRequestIssue('2026-11-10', [validItem]), null);
  assert.equal(validation.equipmentRequestIssue('2026-11-10', [{...validItem, uom: 'sets'}]), null);
  for (const [patch, field] of [[{equipmentName: ''}, 'name'], [{quantityNeeded: 0}, 'qty'], [{uom: ''}, 'uom'], [{purpose: ''}, 'purpose']]) {
    const issue = validation.equipmentRequestIssue('2026-11-10', [validItem, {...validItem, ...patch}]);
    assert.equal(issue.index, 1); assert.equal(issue.field, field);
  }
  assert.equal(validation.equipmentRequestIssue('', [validItem]).field, 'dateRequired');
});

test('create and edit reject incomplete inline cards before any database write', async () => {
  let connected = 0;
  const actions = load('lib/equipment-requests/actions.ts', name => {
    if (name.endsWith('/validation')) return validation;
    if (name.endsWith('/project-access')) return {requireProjectAccess: async () => ({id: 'actor'})};
    if (name.endsWith('/server')) return {createClient: async () => {connected++; throw new Error('Unexpected database call');}};
    return {};
  });
  for (const items of [[validItem, {...validItem, equipmentName: ''}], [{...validItem, uom: ''}]]) {
    const data = new FormData(); data.set('dateRequired', '2026-11-10'); data.set('items', JSON.stringify(items));
    assert.ok((await actions.createEquipmentRequest(1, {}, data)).error);
    assert.ok((await actions.updateEquipmentRequest(1, 1, {}, data)).error);
  }
  assert.equal(connected, 0);
});

test('saving an edited request inserts newly added cards and keeps existing item fulfillment', async () => {
  const writes = [];
  const actions = load('lib/equipment-requests/actions.ts', name => {
    if (name.endsWith('/validation')) return validation;
    if (name.endsWith('/status')) return {deriveEquipmentRequestStatus: () => 'partially_fulfilled'};
    if (name.endsWith('/project-access')) return {requireProjectAccess: async () => ({id: 'actor'})};
    if (name.endsWith('/revalidate')) return {revalidateProjectPaths() {}};
    if (name.endsWith('/server')) return {createClient: async () => ({from(table) {
      const query = {
        select: () => query, eq: () => query,
        single: async () => ({data: {status: 'approved'}}),
        insert(value) {writes.push({table, operation: 'insert', value}); return query;},
        update(value) {writes.push({table, operation: 'update', value}); return query;},
        then(resolve) {return Promise.resolve({data: [{id: 12}], error: null}).then(resolve);},
      };
      return query;
    }})};
    return {};
  });
  const data = new FormData(); data.set('dateRequired', '2026-11-10');
  data.set('items', JSON.stringify([validItem, {...validItem, id: null, equipmentName: 'Scaffold', quantityFulfilled: 0}]));
  assert.equal((await actions.updateEquipmentRequest(1, 1, {}, data)).success, true);
  const inserted = writes.find(w => w.operation === 'insert');
  assert.equal(inserted.value.length, 1);
  assert.equal(inserted.value[0].equipment_name, 'Scaffold');
  assert.equal(inserted.value[0].equipment_request_id, 1);
  assert.equal(writes.find(w => w.table === 'equipment_request_items' && w.operation === 'update').value.quantity_fulfilled, 1);
});
