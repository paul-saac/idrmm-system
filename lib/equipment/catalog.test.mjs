import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('./data.ts', import.meta.url), 'utf8');
function pure(file, mocks = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', compiled)(name => mocks[name], exports);
  return exports;
}
const usage = pure('./usage-status.ts', { '@/lib/cost-estimate/schedule-dates': pure('../cost-estimate/schedule-dates.ts') });
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-11-04T12:00:00Z'])); }
}

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
  const output = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', 'Date', compiled)(name => {
    if (name === '@/lib/supabase/server') return { createClient: async () => client };
    if (name === '@/lib/materials/purchases') return {};
    if (name === '@/lib/equipment/usage-status') return usage;
    if (name === '@/lib/cost-estimate/data') return {getCostEstimate:async(projectId, strict)=>{
      assert.equal(strict,true);
      if(errors.estimate_tasks || errors['estimate:'+projectId])throw new Error('Progress unavailable');
      const categories=(tables.estimate_categories??[]).filter(row=>row.project_id===projectId);
      const tasks=(tables.estimate_tasks??[]).filter(row=>row.project_id===projectId);
      const categoryIds=[...new Set([...categories.map(row=>row.id),...tasks.map(row=>row.category_id)])];
      return {categories:categoryIds.map(id=>{
        const row=categories.find(row=>row.id===id)??{id,category_name:'Task phase'};
        return {id,name:row.category_name,plannedStartDate:row.planned_start_date??null,plannedEndDate:row.planned_end_date??null,
          percentComplete:row.saved_percent??0,tasks:tasks.filter(task=>task.category_id===id).map(task=>({id:task.id,name:task.task_name,
            plannedStartDate:task.planned_start_date??null,plannedEndDate:task.planned_end_date??null,percentComplete:task.saved_percent??0}))};
      })};
    }};
    throw new Error(`Unexpected import: ${name}`);
  }, output.exports, TestDate);
  return output.exports.listEquipment();
}
const equipment = [{ id: 1, name: 'Mixer', status: 'assigned', current_project_id: 4 }];
const plans = [
  { equipment_id: 1, project_id: 4, item_key: 'task-10' },
  { equipment_id: 1, project_id: 4, item_key: 'category-2' },
];
const fixture = () => ({
  equipment,
  projects: [{ id: 4, project_name: 'Test Project' }],
  equipment_task_plans: plans,
  estimate_tasks: [{ id: 10, project_id: 4, category_id: 3, task_name: 'Footings', planned_start_date: '2026-11-04', planned_end_date: '2026-11-06' }],
  estimate_categories: [{ id: 2, project_id: 4, category_name: 'Mobilization', planned_start_date: '2026-11-05', planned_end_date: '2026-11-07' }],
  equipment_assignments: [{ id: 5, equipment_id: 1, project_id: 4, returned_at: null }],
  equipment_task_assignments: [{ equipment_assignment_id: 5, project_id: 4, task_id: 10, task_name: 'Footings', released_at: null }],
});

test('catalog resolves main tasks and subtasks and merges active placement with its plan', async () => {
  const [row] = await catalog(fixture());
  assert.equal(row.currentProjectName, 'Test Project');
  assert.deepEqual(row.taskAssignments.map(task => [task.taskName, task.kind]), [['Footings', 'in_use'], ['Mobilization', 'planned']]);
  assert.equal(row.assignmentLoadError, false);
  assert.deepEqual(row.taskAssignments.map(task => [task.startDate, task.endDate, task.useStatus]), [
    ['2026-11-04', '2026-11-06', 'planned'], ['2026-11-05', '2026-11-07', 'upcoming'],
  ]);
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
  assert.equal(usage.equipmentUseStatus(row), 'assigned');
});

test('placement-only subtasks receive current task dates and missing schedules stay Planned', async () => {
  const tables = fixture(); tables.equipment_task_plans = [];
  let [row] = await catalog(tables);
  assert.equal(row.taskAssignments[0].useStatus, 'planned');
  assert.equal(row.taskAssignments[0].endDate, '2026-11-06');
  tables.estimate_tasks[0].planned_start_date = null;
  [row] = await catalog(tables);
  assert.equal(row.taskAssignments[0].useStatus, 'planned');
});

test('main-task schedules roll up their child dates rather than stale category dates', async () => {
  const tables = fixture();
  tables.estimate_tasks[0].category_id = 2;
  tables.estimate_tasks.push({ id: 11, project_id: 4, category_id: 2, task_name: 'Other subtask',
    planned_start_date: '2026-11-07', planned_end_date: '2026-11-10' });
  const [row] = await catalog(tables);
  const main = row.taskAssignments.find(task => task.itemKey === 'category-2');
  assert.equal(main.startDate, '2026-11-04'); assert.equal(main.endDate, '2026-11-10');
  assert.equal(main.useStatus, 'planned');
});

test('only saved actual progress starts or completes work; dates alone leave tasks Upcoming or Planned', () => {
  const unfinished={started:false,completed:false};
  for (const [day, expected] of [['2026-11-03','upcoming'], ['2026-11-04','planned'], ['2026-11-06','planned'], ['2026-11-07','planned']]) {
    assert.equal(usage.equipmentTaskUseStatus('2026-11-04','2026-11-06',day,unfinished), expected);
  }
  assert.equal(usage.equipmentTaskUseStatus('2026-11-04','2026-11-04','2026-11-04',unfinished), 'planned');
  assert.equal(usage.equipmentTaskUseStatus(null,null,'2026-11-04',{started:true,completed:true}), 'completed');
  assert.equal(usage.equipmentTaskUseStatus('2026-11-09','2026-11-10','2026-11-04',{started:true,completed:false}), 'ongoing');
  assert.equal(usage.equipmentTaskUseStatus(null,null,'2026-11-04',null), 'unknown');
  assert.equal(usage.equipmentTaskUseStatus('2026-11-01','2026-11-02','2026-11-04',{started:true,completed:false}), 'ongoing');
  assert.equal(usage.equipmentTaskUseStatus(null,null,'2026-11-04',{started:true,completed:false}), 'ongoing');
  for (const dates of [[null,null], ['2026-11-04',null], ['2026-02-30','2026-11-06'], ['2026-11-06','2026-11-04']]) {
    assert.equal(usage.equipmentTaskUseStatus(...dates,'2026-11-04',unfinished), 'planned');
  }
});

test('physical equipment status stays separate from task progress and task-date errors', () => {
  for (const status of ['available','assigned','maintenance','retired']) {
    assert.equal(usage.equipmentUseStatus({status,assignmentLoadError:true,taskAssignments:[{useStatus:'completed'}]}),status);
  }
});

test('editing saved progress reopens task equipment status and all children must complete a parent', async () => {
  const tables=fixture();tables.estimate_tasks[0].saved_percent=100;
  let [row]=await catalog(tables);assert.equal(row.taskAssignments[0].useStatus,'completed');
  tables.estimate_tasks[0].saved_percent=40;
  [row]=await catalog(tables);assert.equal(row.taskAssignments[0].useStatus,'ongoing');
  tables.estimate_tasks[0].category_id=2;
  tables.estimate_tasks.push({id:11,category_id:2,project_id:4,task_name:'Other subtask',saved_percent:100});
  [row]=await catalog(tables);assert.equal(row.taskAssignments.find(task=>task.itemKey==='category-2').useStatus,'ongoing');
  tables.estimate_tasks[0].saved_percent=100;
  [row]=await catalog(tables);assert.equal(row.taskAssignments.find(task=>task.itemKey==='category-2').useStatus,'completed');
});

test('task date ranges retain the stored calendar dates across client time zones', () => {
  assert.equal(usage.equipmentTaskDateRange('2026-11-04','2026-11-06'), 'Nov 4, 2026 – Nov 6, 2026');
  assert.equal(usage.equipmentTaskDateRange('2026-11-04','2026-11-04'), 'Nov 4, 2026');
  assert.equal(usage.equipmentTaskDateRange(null,null), 'Dates not set');
  assert.match(usage.equipmentTaskDateRange(null,'2026-11-06'), /^Start not set/);
});


test('catalog exposes recorded task allocation time separately from project checkout time',async()=>{
 const tables=fixture();tables.equipment=tables.equipment.map(row=>({...row,last_task_assigned_at:'2026-11-04T12:00:00Z'}));
 const [row]=await catalog(tables);assert.equal(row.lastTaskAssignedAt,'2026-11-04T12:00:00Z');
 const [legacy]=await catalog(fixture());assert.equal(legacy.lastTaskAssignedAt,null);
});


test('a failed project lookup only marks its equipment, not unrelated or unallocated equipment',async()=>{
 const tables=fixture();tables.equipment=[...equipment,{id:2,name:'Unallocated',status:'available'}, {id:3,name:'Other tool',status:'assigned'}];
 tables.projects.push({id:8,project_name:'Other visible project'});
 tables.equipment_task_plans.push({equipment_id:3,project_id:8,item_key:'task-80'});
 const rows=await catalog(tables,{'estimate:8':true});
 assert.equal(rows[0].assignmentLoadError,false);
 assert.equal(rows[1].assignmentLoadError,false);
 assert.equal(rows[2].assignmentLoadError,true);
});

test('hidden project assignments do not trigger cost/progress queries or false loading errors',async()=>{
 const tables=fixture();tables.projects=[];
 const rows=await catalog(tables,{'estimate:4':true});
 assert.equal(rows[0].assignmentLoadError,false);
 assert.deepEqual(rows[0].taskAssignments,[]);
});
