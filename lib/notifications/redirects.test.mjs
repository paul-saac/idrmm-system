import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function compile(source, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, { exports, require: name => dependencies[name] ?? {}, URL, URLSearchParams, console, ...globals });
  return exports;
}
function namedFunction(source, name) {
  const ast = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(result, name); return result;
}

const { notificationLink } = compile(read('./link.ts'));
for (const basePath of ['/admin', '/project-manager', '/foreman']) {
  test(`${basePath}: all notification kinds route to the correct project, tab and record`, () => {
    const cases = [
      ['progress_override', 'task', { progress: 'task-42', progressDate: '2026-10-22' }],
      ['progress_override', 'category', { progress: 'category-42', progressDate: '2026-10-22' }],
      ['material_request', 'material_request', { tab: 'materials', subtab: 'requests', request: '42' }],
      ['equipment_request', 'equipment_request', { tab: 'equipment', subtab: 'requests', request: '42' }],
      ['sheet_submitted', 'sheet', { tab: 'overview', sheet: '42' }],
      ['safety_incident', 'incident', { incident: '42' }],
    ];
    for (const [kind, itemKind, params] of cases) {
      const notification = { kind, itemKind, projectId: 7, itemId: 42, entryDate: '2026-10-22' };
      // Routing belongs to the recipient. The sender's role cannot change it.
      for (const actorName of ['Super Administrator', 'Administrator', 'Project Manager', 'Foreman', null]) {
        const url = new URL(notificationLink(basePath, { ...notification, actorName }), 'https://idrmm.online');
        assert.equal(url.pathname, `${basePath}/projects/7`);
        assert.deepEqual(Object.fromEntries(url.searchParams), params);
      }
    }
  });
}
test('legacy notifications without a log date still open the latest progress record', () => {
  assert.equal(notificationLink('/admin', { kind: 'progress_override', itemKind: 'task', projectId: 7, itemId: 42 }), '/admin/projects/7?progress=task-42');
});

// Exercise the real components' render/effect transitions without authenticating
// against production or performing any real writes. Async lookups are deferred.
function hooks() {
  const slots = []; let cursor = 0, dirty = false, pending = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => {
        const value = typeof next === 'function' ? next(slots[i]) : next;
        if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!equal(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!equal(slots[i]?.deps, deps)) pending.push({ i, fn, deps });
    },
  };
  return { react, render(fn) {
    let tree, attempts = 0;
    do { assert.ok(attempts++ < 20, 'render settles'); cursor = 0; dirty = false; pending = []; tree = fn(); } while (dirty);
    for (const { i, fn, deps } of pending) { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }
    return tree;
  } };
}
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function locationFixture(initial) {
  const location = { href: initial };
  return { location, history: { replaceState(_state, _title, path) { location.href = new URL(path, location.href).href; } } };
}

test('progress deep links select task/category separately, exact log date, and read-only mode', () => {
  const source = read('../../components/projects/progress/gantt-chart-view.tsx');
  const start = source.indexOf('  const progressParam =');
  const block = source.slice(start, source.indexOf('  useEffect(() => {', start));
  const h = hooks(); let target = null, params = new URLSearchParams();
  const { open } = compile(`export function open(useState, searchParams, categoriesForDisplay, setProgressModal) { ${block} }`);
  const categories = [{ id: 42, tasks: [] }, { id: 9, tasks: [{ id: 42 }, { id: 43, isMilestone: true }] }];
  const render = () => h.render(() => open(h.react.useState, params, categories, value => { target = value; }));
  render(); assert.equal(target, null);
  params = new URLSearchParams('progress=task-42&progressDate=2026-10-22'); render();
  assert.equal(target.kind, 'task'); assert.equal(target.readOnly, true); assert.equal(target.highlightEntryDate, '2026-10-22');
  params = new URLSearchParams('progress=category-42'); render();
  assert.equal(target.kind, 'category'); assert.equal(target.highlightLatest, true);
  params = new URLSearchParams(); render(); target = null;
  params = new URLSearchParams('progress=category-42'); render(); assert.equal(target.kind, 'category');
  for (const invalid of ['task-999', 'task-43', 'category-9', 'other-42']) {
    target = null; params = new URLSearchParams({ progress: invalid }); render(); assert.equal(target, null);
  }
});

test('collapsed editor history never scrolls the modal to an invisible record', () => {
  const source = read('../../components/projects/progress/progress-tracking-modal-content.tsx');
  for (const name of ['LastOverride', 'OverrideHistory']) {
    const fn = namedFunction(source, name);
    const ast = ts.createSourceFile('fn.tsx', fn, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
      if (ts.isCallExpression(node) && ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(ast)) && node.arguments[0]?.getText(ast).includes('scrollIntoView')) callback = node.arguments[0].getText(ast);
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(callback);
    let hidden = true, calls = 0;
    const element = { closest: () => hidden ? {} : null, scrollIntoView: () => calls++ };
    const { run } = compile(`export function run(ref, targetRef, highlight, targetLogId) { return (${callback})(); }`);
    run({ current: element }, { current: element }, true, 42); assert.equal(calls, 0);
    hidden = false; run({ current: element }, { current: element }, true, 42); assert.equal(calls, 1);
  }
});

test('notification mode is read-only for every recipient; ordinary Gantt clicks retain edit permissions', () => {
  const source = read('../../components/projects/progress/gantt-chart-view.tsx');
  const ast = ts.createSourceFile('gantt.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ProgressTrackingModal') {
      expression = node.attributes.properties.find(p => p.name?.getText(ast) === 'readOnly').initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(expression);
  const { readonly } = compile(`export function readonly(canEdit, progressModal) { return ${expression}; }`);
  assert.equal(readonly(true, { readOnly: true }), true);
  assert.equal(readonly(false, { readOnly: true }), true);
  assert.equal(readonly(true, { kind: 'task' }), false);
  assert.equal(readonly(false, { kind: 'task' }), true);
});

test('refreshed progress history updates a read-only snapshot without resetting editable drafts', () => {
  const h = hooks();
  const { ProgressTrackingModal } = compile(read('../../components/projects/progress/progress-tracking-modal.tsx'), {
    react: h.react, 'react/jsx-runtime': runtime,
    '@/components/ui/modal': { Modal: 'Modal' },
    '@/components/portal/portal-context': { usePortal: () => ({ isAdmin: true }) },
    './progress-tracking-modal-content': { ProgressTrackingModalContent: 'Content' },
    '@/lib/task-progress/calculate': { EMPTY_PROGRESS_ANCHOR: {}, groupPlannedMaterials: () => [], groupPlannedOtherCosts: () => [] },
  });
  const task = { id: 42, name: 'Footings', materialAssignments: [], equipmentCostItems: [], otherCostItems: [] };
  let props = { target: { kind: 'task', task, highlightEntryDate: '2026-10-22' }, readOnly: true, categories: [], taskProgressToday: {}, categoryProgressToday: {}, overrideHistory: {}, onClose() {} };
  const render = () => h.render(() => ProgressTrackingModal(props));
  const content = tree => nodes(tree, node => node.type === 'Content')[0];
  const initialKey = content(render()).key;
  props = { ...props, overrideHistory: { 'task-42': [{ id: 8 }] } };
  const fresh = content(render()); assert.notEqual(fresh.key, initialKey); assert.equal(fresh.props.overrideHistory[0].id, 8);
  props = { ...props, readOnly: false }; const editorKey = content(render()).key;
  props = { ...props, overrideHistory: { 'task-42': [{ id: 9 }, { id: 8 }] } };
  assert.equal(content(render()).key, editorKey);
});

test('notification navigation is immediate even if marking it read is slow or fails', async () => {
  const fn = namedFunction(read('../../components/notifications/notification-bell.tsx'), 'openNotification');
  const { bind } = compile(`export function bind(context) { const {setOpen,router,notificationLink,basePath,markRead}=context; ${fn}; return openNotification; }`);
  const pending = deferred(), calls = [];
  const open = bind({ setOpen: v => calls.push(['open', v]), router: { push: v => calls.push(['push', v]) }, notificationLink, basePath: '/admin', markRead: () => pending.promise });
  open({ id: 1, kind: 'safety_incident', projectId: 7, itemId: 42, read: false });
  assert.deepEqual(calls, [['open', false], ['push', '/admin/projects/7?incident=42']]);
  pending.reject(Error('Offline')); await settle(); assert.equal(calls.length, 2);
});

test('same-workspace request links expand the correct row, preserve other rows and can reopen', () => {
  const source = read('../../components/projects/project-detail-view.tsx');
  const start = source.indexOf('  const requestTarget =');
  const block = source.slice(start, source.indexOf('  function toggleEquipmentRequest', start));
  const h = hooks(), win = locationFixture('https://idrmm.online/admin/projects/7');
  const { open } = compile(`export function open(context) { const {useState,useEffect,searchParams,tabParam,subtabParam,setActiveTab,setMaterialsRecordView,setEquipmentRecordList,setOpenRequestIds,setOpenEquipmentRequestIds}=context; ${block} }`, {}, { window: win });
  const state = { material: new Set([3]), equipment: new Set([4]) };
  const render = () => h.render(() => {
    const searchParams = new URL(win.location.href).searchParams;
    return open({ ...h.react, searchParams, tabParam: searchParams.get('tab'), subtabParam: searchParams.get('subtab'), setActiveTab: v => state.tab = v, setMaterialsRecordView: v => state.materialView = v, setEquipmentRecordList: v => state.equipmentView = v, setOpenRequestIds: fn => state.material = fn(state.material), setOpenEquipmentRequestIds: fn => state.equipment = fn(state.equipment) });
  });
  render();
  for (const tab of ['materials', 'equipment']) {
    win.location.href = `https://idrmm.online/admin/projects/7?tab=${tab}&subtab=requests&request=42`; render();
    const key = tab === 'materials' ? 'material' : 'equipment';
    assert.equal(state.tab, tab); assert.equal(state[`${key}View`], 'requests'); assert.ok(state[key].has(42));
    assert.ok(state[key].has(key === 'material' ? 3 : 4));
    assert.equal(new URL(win.location.href).searchParams.has('request'), false);
    render(); state[key].delete(42);
    win.location.href = `https://idrmm.online/admin/projects/7?tab=${tab}&subtab=requests&request=42`; render(); assert.ok(state[key].has(42)); render();
  }
});

test('a linked request clears search/status filters that would hide it, without blocking later filtering', () => {
  for (const file of ['materials/materials-monitoring-view.tsx', 'equipment/equipment-record-view.tsx']) {
    const source = read(`../../components/projects/${file}`);
    const start = source.indexOf('  const [handledLinkedRequest,');
    const end = source.indexOf('\n  const [requestOpen,', start);
    const block = source.slice(start, end);
    const { update } = compile(`export function update(useState, linkedRequestId, setRequestQuery, setRequestStatus) { ${block} }`);
    const h = hooks(); let id, query = 'Hidden', status = 'rejected';
    const render = () => h.render(() => update(h.react.useState, id, v => query = v, v => status = v));
    render(); assert.equal(query, 'Hidden');
    id = 42; render(); assert.equal(query, ''); assert.equal(status, 'all');
    query = 'Manual search'; status = 'submitted'; render(); assert.equal(query, 'Manual search');
    id = undefined; render(); id = 42; render(); assert.equal(query, ''); assert.equal(status, 'all');
  }
});

test('incident redirects never display the previous incident; errors and loading remain visible', async () => {
  const h = hooks(), requests = [];
  const { IncidentDetailModal } = compile(read('../../components/projects/progress/incident-detail-modal.tsx'), {
    react: h.react, 'react/jsx-runtime': runtime,
    '@/components/ui/modal': { Modal: 'Modal' },
    '@/lib/incidents/actions': { loadIncident: (projectId, id) => { const pending = deferred(); requests.push({ projectId, id, ...pending }); return pending.promise; } },
  });
  let props = { projectId: 7, id: 42, onClose() {} };
  const render = () => h.render(() => IncidentDetailModal(props));
  let tree = render(); assert.equal(nodes(tree, node => node.props.role === 'status').length, 1);
  requests[0].resolve({ incident: { id: 42, occurred_on: '2026-10-22' } }); await settle(); tree = render();
  assert.ok(nodes(tree, node => node.props.result?.incident?.id === 42).length);
  props = { ...props, id: 43 }; tree = render();
  assert.equal(nodes(tree, node => node.props.result?.incident?.id === 42).length, 0);
  assert.equal(nodes(tree, node => node.props.role === 'status').length, 1);
  requests[1].reject(Error('Offline')); await settle(); tree = render();
  assert.match(nodes(tree, node => node.props.result?.error)[0].props.result.error, /Could not load/);
  props = { ...props, projectId: 8 }; tree = render(); assert.equal(nodes(tree, node => node.props.result?.error).length, 0);
  props = { ...props, result: { incident: { id: 43, occurred_on: '2026-10-23' } } }; tree = render();
  assert.equal(nodes(tree, node => node.props.role === 'status').length, 0);
  assert.ok(nodes(tree, node => node.props.result?.incident?.id === 43).length);
  requests[2].resolve({ error: 'Old project' }); await settle(); tree = render();
  assert.ok(nodes(tree, node => node.props.result?.incident?.id === 43).length);
});

test('sheet notification opens its revision immediately, supports repeated links and ignores stale responses', async () => {
  const h = hooks(), requests = [], win = locationFixture('https://idrmm.online/admin/projects/7?tab=overview&sheet=42');
  const { SheetsSection } = compile(read('../../components/projects/sheets/sheets-section.tsx'), {
    react: h.react, 'react/jsx-runtime': runtime,
    'next/navigation': { useSearchParams: () => new URL(win.location.href).searchParams },
    '@/components/ui/modal': { Modal: 'Modal', ModalFooter: 'ModalFooter', ModalHeaderAddon: 'ModalHeaderAddon' },
    './document-preview': { documentFileUrl: (projectId, id) => `/api/projects/${projectId}/sheets/${id}/file` },
    '@/lib/sheets/model': compile(read('../sheets/model.ts')),
    '@/lib/sheets/actions': { sheetDetails: (projectId, id) => { const pending = deferred(); requests.push({ projectId, id, ...pending }); return pending.promise; } },
  }, { window: win });
  const sheet = { id: 42, sheet_number: 'A-1', title: 'Plan', document_type: 'drawing', revision: 1, status: 'submitted', file_path: '7/plan.pdf', created_at: '2026-10-22', submitted_name: 'Super Administrator' };
  const props = { projectId: 7, initialSheets: [sheet] };
  const render = () => h.render(() => SheetsSection(props));
  let tree = render();
  const modal = () => nodes(tree, node => node.type === 'Modal' && node.props.open)[0];
  assert.equal(modal().props.title, 'A-1'); assert.equal(requests[0].id, 42); assert.equal(requests[0].projectId, 7);
  assert.ok(nodes(tree, node => node.props['aria-selected'] && node.props.children === 'Construction Drawings').length);
  modal().props.onClose(); tree = render(); assert.equal(modal(), undefined); assert.equal(new URL(win.location.href).searchParams.has('sheet'), false);
  win.location.href = 'https://idrmm.online/admin/projects/7?tab=overview&sheet=42'; tree = render(); assert.equal(modal().props.title, 'A-1');
  win.location.href = 'https://idrmm.online/admin/projects/7?tab=overview&sheet=99'; tree = render(); assert.equal(modal().props.title, 'Document');
  requests[1].resolve({ sheet, drawingUrl: 'signed', evidenceUrl: null, reviews: [], error: null }); await settle(); tree = render();
  assert.equal(modal().props.title, 'Document');
  requests[2].resolve({ sheet: null, drawingUrl: null, evidenceUrl: null, reviews: [], error: 'Sheet not found or access denied.' }); await settle(); tree = render();
  assert.ok(nodes(tree, node => node.props.role === 'alert' && node.props.children === 'Sheet not found or access denied.').length);
  assert.deepEqual(plain(requests.map(({ projectId, id }) => ({ projectId, id }))), [{ projectId: 7, id: 42 }, { projectId: 7, id: 42 }, { projectId: 7, id: 99 }]);
});
