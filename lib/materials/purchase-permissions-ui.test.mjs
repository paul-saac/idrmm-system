import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const jsx = (type, props) => ({ type, props });
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes)
  : value.type === 'modal' && !value.props.open ? [] : [value, ...nodes(value.props?.children)];
const text = value => value == null ? '' : typeof value !== 'object' ? String(value)
  : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);

test('purchases remain viewable, but recording and deletion controls appear only for editable Admin projects', () => {
  for (const basePath of ['/foreman', '/project-manager', '/admin']) for (const canEdit of [true, false]) {
    const states = []; let cursor = 0;
    const mocks = {
      react: {
        useEffect() {}, useId: () => 'purchase-form', useMemo: fn => fn(),
        useState(initial) {
          const slot = cursor++;
          if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
          return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }];
        },
      },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      'next/navigation': { useRouter: () => ({}) },
      '@/components/portal/portal-context': { usePortal: () => ({ basePath, isAdmin: basePath === '/admin' }) },
      '@/components/projects/project-access-context': { useProjectCanEdit: () => canEdit, ProjectWriteButton: 'write-button' },
      '@/components/ui/modal': { Modal: 'modal', ModalFooter: 'footer' },
      '@/components/ui/view-menu': { ViewMenu: 'view-menu' },
      '@/lib/materials/purchases-model': { computeMaterialStocks: () => [] },
    };
    const code = ts.transpileModule(readFileSync(new URL('../../components/projects/materials/material-purchases-view.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    runInNewContext(code, { exports, require: name => mocks[name] ?? {} });
    const render = () => { cursor = 0; return exports.MaterialPurchasesView({ projectId: 1, usage: [], initialPurchases: [
      { id: 1, purchase_date: '2026-11-21', material_name: 'Cement', supplier: 'Supplier', unit: 'bags', quantity: 5, received_quantity: 5, unit_price: 250, amount: 1250 },
    ] }); };
    let tree = render();
    const canManage = canEdit && basePath === '/admin';
    assert.equal(nodes(tree).some(n => n.type === 'write-button' && text(n).includes('Record Purchase')), canManage);
    nodes(tree).find(n => n.type === 'view-menu').props.onChange('purchases');
    tree = render();
    assert.match(text(tree), /Cement/);
    assert.equal(nodes(tree).some(n => n.props?.title === 'Delete purchase'), canManage);
    assert.equal(nodes(tree).some(n => n.type === 'th' && text(n) === 'Actions'), canManage);
  }
});
