import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('./data.ts', import.meta.url), 'utf8');

function catalog(tables, errors = {}) {
  const client = { from(table) {
    let rows = tables[table] ?? [];
    const query = {
      select() { return this; }, order() { return this; },
      in(column, values) { rows = rows.filter(row => values.includes(row[column])); return this; },
      is(column, value) { rows = rows.filter(row => row[column] === value); return this; },
      then(resolve) { return Promise.resolve({ data: errors[table] ? null : rows, error: errors[table] ?? null }).then(resolve); },
    };
    return query;
  }};
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', compiled)(name => {
    if (name === '@/lib/supabase/server') return { createClient: async () => client };
    if (name === '@/lib/materials/purchases') return {};
    throw new Error(`Unexpected import: ${name}`);
  }, module.exports);
  return module.exports.listEquipment();
}
const equipment = [{ id: 1, name: 'Mixer', current_project_id: 4 }];
const plans = [
  { equipment_id: 1, project_id: 4, item_key: 'task-10' },
  { equipment_id: 1, project_id: 4, item_key: 'category-2' },
];
const fixture = () => ({
  equipment,
  projects: [{ id: 4, project_name: 'Test Project' }],
  equipment_task_plans: plans,
  estimate_tasks: [{ id: 10, project_id: 4, task_name: 'Footings' }],
  estimate_categories: [{ id: 2, project_id: 4, category_name: 'Mobilization' }],
  equipment_assignments: [{ id: 5, equipment_id: 1, project_id: 4, returned_at: null }],
  equipment_task_assignments: [{ equipment_assignment_id: 5, project_id: 4, task_id: 10, task_name: 'Footings', released_at: null }],
});

test('catalog resolves main tasks and subtasks and merges active placement with its plan', async () => {
  const [row] = await catalog(fixture());
  assert.equal(row.currentProjectName, 'Test Project');
  assert.deepEqual(row.taskAssignments.map(task => [task.taskName, task.kind]), [['Footings', 'in_use'], ['Mobilization', 'planned']]);
  assert.equal(row.assignmentLoadError, false);
});

test('returned equipment and released task placements are excluded from active assignments', async () => {
  const tables = fixture();
  tables.equipment_task_plans = [];
  tables.equipment_task_assignments[0].released_at = '2026-11-02';
  assert.deepEqual((await catalog(tables))[0].taskAssignments, []);
  tables.equipment_task_assignments[0].released_at = null;
  tables.equipment_assignments[0].returned_at = '2026-11-02';
  assert.deepEqual((await catalog(tables))[0].taskAssignments, []);
});

test('inaccessible project records do not disclose task names', async () => {
  const tables = fixture();
  tables.projects = [];
  const [row] = await catalog(tables);
  assert.equal(row.currentProjectName, null);
  assert.deepEqual(row.taskAssignments, []);
});

test('assignment query failure preserves equipment and reports incomplete details', async () => {
  const [row] = await catalog(fixture(), { equipment_task_plans: { message: 'Unavailable' } });
  assert.equal(row.name, 'Mixer');
  assert.equal(row.assignmentLoadError, true);
});
