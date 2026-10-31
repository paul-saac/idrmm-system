import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('./gantt-dependency-preview.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { dependencyDragPath, createDependencyDragPreview } = exports;
const geometry = { fromX: 100, toX: 180, fromY: 20, toY: 60, rowOffset: 17, indent: 12 };
const plain = value => JSON.parse(JSON.stringify(value));

test('incoming and outgoing connectors follow only the dragged endpoint, including crossing bars', () => {
  assert.equal(dependencyDragPath(geometry, 40, 0).path, 'M 140 20 h 12 v 17  V 60 h 28');
  assert.equal(dependencyDragPath(geometry, 0, -100).path, 'M 100 20 h 12 v 17 H 68 V 60 h 12');
  assert.equal(dependencyDragPath(geometry, 120, 0).path, 'M 220 20 h 12 v 17 H 168 V 60 h 12');
  assert.ok(dependencyDragPath(geometry, 0, 35).points.startsWith('215,60'));
});

test('both selected endpoints move together without changing routing or arrowhead placement', () => {
  assert.equal(dependencyDragPath(geometry, 40, 40).path, 'M 140 20 h 12 v 17  V 60 h 68');
  assert.equal(dependencyDragPath(geometry, 40, 40).points, '220,60 215,55 215,65');
  assert.equal(dependencyDragPath({ ...geometry, rowOffset: -17 }, -40, -40).path,
    'M 60 20 h 12 v -17  V 60 h 68');
});

test('right-to-left geometry preserves the signed offsets', () => {
  const rtl = { ...geometry, fromX: 180, toX: 100, indent: -12 };
  assert.equal(dependencyDragPath(rtl, 0, 0).path, 'M 180 20 h -12 v 17  V 60 h -68');
  assert.equal(dependencyDragPath(rtl, -100, 0).path, 'M 80 20 h -12 v 17 H 112 V 60 h -12');
});

class AttributeNode {
  constructor(attribute, value) { this.attributes = new Map([[attribute, value]]); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
}
function connector(from = '1', to = '2') {
  const path = new AttributeNode('d', 'original path'), polygon = new AttributeNode('points', 'original points');
  return { path, polygon,
    dataset: { ganttFrom: from, ganttTo: to, ganttFromX: '100', ganttToX: '180', ganttFromY: '20',
      ganttToY: '60', ganttRowOffset: '17', ganttIndent: '12' },
    querySelector: name => name === 'path' ? path : polygon,
  };
}

test('drag frames reuse cached geometry, leave unrelated links alone, and restore on cancel/drop', () => {
  const moved = connector(), unrelated = connector('3', '4'); let scans = 0;
  const preview = createDependencyDragPreview({ querySelectorAll() { scans++; return [moved, unrelated]; } }, new Set(['1']));
  for (let x = 1; x <= 100; x++) preview.paint(x);
  assert.equal(scans, 1);
  assert.equal(moved.path.getAttribute('d'), dependencyDragPath(geometry, 100, 0).path);
  assert.equal(unrelated.path.getAttribute('d'), 'original path');
  preview.restore();
  assert.equal(moved.path.getAttribute('d'), 'original path');
  assert.equal(moved.polygon.getAttribute('points'), 'original points');
});

test('a replacement connector is recached during a background render and restored too', () => {
  const first = connector(); let nodes = [first];
  const preview = createDependencyDragPreview({ querySelectorAll: () => nodes }, new Set(['1', '2']));
  preview.paint(15);
  const second = connector(); nodes = [second]; preview.recache(); preview.paint(25);
  assert.deepEqual(plain(second.path.getAttribute('d')), dependencyDragPath(geometry, 25, 25).path);
  preview.restore();
  assert.equal(first.path.getAttribute('d'), 'original path');
  assert.equal(second.path.getAttribute('d'), 'original path');
});
