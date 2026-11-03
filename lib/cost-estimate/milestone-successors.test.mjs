import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const plain = value => JSON.parse(JSON.stringify(value));
function compile(relative, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require: name => mocks[name], FormData, console: { error() {} } });
  return exports;
}
const options = compile('./successor-options.ts');
const modal = compile('../../components/projects/progress/schedule-modal-edits.ts', { '@/lib/cost-estimate/dependency-model': compile('./dependency-model.ts') });
const fixture = () => [
  { id: 1, name: 'Start', isMilestone: true, tasks: [] },
  { id: 2, name: 'Concrete', isMilestone: false, tasks: [
    { id: 1, name: 'Footings', isMilestone: false, predecessorTaskId: null, totalEstimateCost: 500, percentComplete: 40 },
    { id: 2, name: 'Columns', isMilestone: false, predecessorTaskId: 1 },
    { id: 3, name: 'Inspection', isMilestone: true, predecessorTaskId: null },
  ] },
  { id: 3, name: 'Finishing', isMilestone: false, tasks: [{ id: 4, name: 'Paint', predecessorTaskId: null }] },
  { id: 4, name: 'Permit', isMilestone: false, tasks: [] },
];
function form(values) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }

test('predecessor choices exclude self and its containing summary; optimistic links preserve other successor branches', () => {
  const base = fixture();
  const choices = options.projectPredecessorOptions(base, {kind:'task',id:1}).map(options.scheduleRowKey);
  assert.ok(!choices.includes('task:1')); assert.ok(!choices.includes('category:2')); assert.ok(choices.includes('category:1'));
  base[2].predecessorCategoryId=1; base[3].predecessorCategoryId=1;
  const edit=modal.scheduleModalEdit('category',1,form({predecessorRowKey:'task:3',successorRowKey:'task:1',previousSuccessorRowKey:'category:3'}));
  const result=modal.applyScheduleModalEdits(base,[edit]);
  assert.equal(result[0].predecessorTaskId,3); assert.equal(result[2].predecessorCategoryId,null);
  assert.equal(result[3].predecessorCategoryId,1); assert.equal(result[1].tasks[0].predecessorCategoryId,1);
  assert.equal(modal.unconfirmedScheduleModalEdits(result,[{token:1,edit,pending:false}]).length,0);
});

test('new dependency action saves both directions atomically and records one history checkpoint',async()=>{
  const calls=[],events=[]; let allowed=true,error=null;
  const actions=compile('./actions.ts',{
    '@/lib/projects/revalidate':{revalidateProjectPaths:()=>events.push('refresh')},
    '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push([name,plain(args)]);return {error};}})},
    '@/lib/auth/project-access':{requireProjectAccess:async()=>allowed?{id:'pm'}:null},
    '@/lib/cost-estimate/undo-redo':{recordGanttCheckpoint:async()=>events.push('checkpoint')},'./other-cost-lines':{},
  });
  const fields=form({predecessorRowKey:'category:1',successorRowKey:'task:2',previousSuccessorRowKey:'task:3',isMilestone:'on'});
  assert.equal((await actions.updateSubtask(1,7,{},fields)).success,true);
  assert.equal(calls[0][0],'save_estimate_links'); assert.equal(calls[0][1].p_predecessor_kind,'category');
  assert.equal(calls[0][1].p_previous_successor_id,3);assert.deepEqual(events,['checkpoint','refresh']);
  allowed=false;assert.ok((await actions.updateSubtask(1,7,{},fields)).error);assert.equal(calls.length,1);
  allowed=true;error={code:'40001',message:'The successor changed in another session.'};
  assert.match((await actions.updateSubtask(1,7,{},fields)).error,/another session/);assert.equal(events.length,2);
});

test('a milestone lists all saved main tasks and subtasks in the project, excluding itself and temporary rows', () => {
  const categories = fixture(); categories.push({ id: -1, name: 'Saving', tasks: [] });
  let result = options.projectSuccessorOptions(categories, { kind: 'category', id: 1 }, true);
  assert.equal(result.length, 7);
  assert.ok(result.some(row => options.scheduleRowKey(row) === 'task:1'));
  assert.ok(result.some(row => row.kind === 'category' && row.id === 2));
  assert.ok(result.some(row => row.name === 'Finishing / Paint'));
  assert.ok(!result.some(row => row.kind === 'category' && row.id === 1));
  assert.ok(!result.some(row => row.id < 0));
  result = options.projectSuccessorOptions(categories, { kind: 'task', id: 3 }, true);
  assert.equal(result.length, 7);
  assert.ok(!result.some(row => row.kind === 'task' && row.id === 3));
});

test('regular task choices allow selecting all project tasks and standalone phases', () => {
  assert.deepEqual(plain(options.projectSuccessorOptions(fixture(), { kind: 'task', id: 1 }, false).map(options.scheduleRowKey)),
    ['category:1', 'task:2', 'task:3', 'category:3', 'task:4', 'category:4']);
  assert.deepEqual(plain(options.projectSuccessorOptions(fixture(), { kind: 'category', id: 1 }, false).map(options.scheduleRowKey)),
    ['category:2', 'task:1', 'task:2', 'task:3', 'category:3', 'task:4', 'category:4']);
});

test('main-task milestone -> subtask updates immediately without confusing overlapping numeric IDs or changing costs/progress', () => {
  const base = fixture(), original = plain(base);
  base[3].predecessorCategoryId = 1;
  const edit = modal.scheduleModalEdit('category', 1, form({ categoryName: 'Start', milestoneField: '1', isMilestone: 'on', successorRowKey: 'task:1' }));
  const result = modal.applyScheduleModalEdits(base, [edit]);
  assert.equal(result[1].tasks[0].predecessorCategoryId, 1);
  assert.equal(result[1].tasks[0].predecessorTaskId, null);
  assert.equal(result[0].predecessorCategoryId, undefined);
  assert.equal(result[3].predecessorCategoryId, null);
  assert.equal(result[1].tasks[0].totalEstimateCost, original[1].tasks[0].totalEstimateCost);
  assert.equal(result[1].tasks[0].percentComplete, 40);
});

test('subtask milestone -> main task or another group is immediate, reversible and confirmed only by the matching server links', () => {
  const base = fixture(); base[1].tasks[1].predecessorTaskId = 3;
  const edit = modal.scheduleModalEdit('task', 3, form({ isMilestone: 'on', successorRowKey: 'category:4' }));
  const entry = { token: 1, edit, pending: false };
  const result = modal.applyScheduleModalEdits(base, [edit]);
  assert.equal(result[3].predecessorTaskId, 3); assert.equal(result[3].predecessorCategoryId, null);
  assert.equal(result[1].tasks[1].predecessorTaskId, null);
  assert.equal(modal.unconfirmedScheduleModalEdits(base, [entry]).length, 1);
  assert.equal(modal.unconfirmedScheduleModalEdits(result, [entry]).length, 0);
  const clear = modal.scheduleModalEdit('task', 3, form({ isMilestone: 'on', successorRowKey: '' }));
  assert.equal(modal.applyScheduleModalEdits(result, [clear])[3].predecessorTaskId, null);
});

test('server actions submit typed successor references through the atomic RPC after checking project access', async () => {
  const calls = [], events = [];
  const client = { rpc: async (name, args) => { calls.push([name, plain(args)]); return { error: null }; } };
  const actions = compile('./actions.ts', {
    '@/lib/projects/revalidate': { revalidateProjectPaths: () => events.push('refresh') },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/auth/project-access': { requireProjectAccess: async () => ({ id: 'pm' }) },
    '@/lib/cost-estimate/undo-redo': { recordGanttCheckpoint: async () => events.push('checkpoint') }, './other-cost-lines': {},
  });
  assert.equal((await actions.updateCategory(1, 7, {}, form({ categoryName: 'Start', milestoneField: '1', isMilestone: 'on', successorRowKey: 'task:4' }))).success, true);
  assert.equal(calls[0][0], 'save_estimate_successor'); assert.equal(calls[0][1].p_source_kind, 'category');
  assert.equal(calls[0][1].p_successor_kind, 'task'); assert.equal(calls[0][1].p_successor_id, 4);
  assert.equal(calls[0][1].p_milestone, true);
  assert.equal((await actions.updateSubtask(3, 7, {}, form({ isMilestone: 'on', successorRowKey: 'category:4' }))).success, true);
  assert.equal(calls[1][1].p_source_kind, 'task'); assert.equal(calls[1][1].p_successor_kind, 'category');
  assert.deepEqual(events, ['checkpoint', 'refresh', 'checkpoint', 'refresh']);
  assert.ok((await actions.updateSubtask(3, 7, {}, form({ successorRowKey: 'other:3' }))).error);
  assert.equal(calls.length, 2);
});

test('dependency checklist searches all predecessors and offers only subtasks as successors', () => {
 const states=[];let cursor=0;
 const fields=compile('../../components/projects/progress/task-dependencies-fields.tsx', {
  react:{useState(initial){const i=cursor++;if(!states[i])states[i]={value:typeof initial==='function'?initial():initial};return[states[i].value,v=>states[i].value=v];}},
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  'lucide-react':{ChevronDown:'chevron',Search:'search'},
  '@/lib/cost-estimate/dependency-model':compile('./dependency-model.ts'),
  './gantt-bar-colors':compile('../../components/projects/progress/gantt-bar-colors.ts'),
 });
 function nodes(tree){return !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];}
 const render=()=>{cursor=0;return nodes(fields.TaskDependenciesFields({id:'deps',source:{kind:'category',id:1},categories:fixture()}));};
 let tree=render();assert.equal(tree.filter(n=>n.type==='label').length,7);
 assert.ok(!tree.some(n=>n.type==='input'&&n.props.disabled));
 assert.ok(tree.some(n=>n.type==='span'&&n.props.children==='Phase'));
 assert.ok(tree.some(n=>n.type==='span'&&n.props.children==='Footings'));
 assert.ok(!tree.some(n=>n.type==='span'&&n.props.children==='Concrete / Footings'));
 assert.match(tree.find(n=>n.type==='select').props.className,/items-center/);
 assert.match(tree.find(n=>n.type==='select').props.className,/h-8/);
 assert.match(tree.find(n=>n.props?.['aria-label']==='Search dependency tasks').props.className,/h-8/);
 assert.ok(tree.some(n=>n.type==='span'&&n.props.style?.backgroundColor));
 tree.find(n=>n.type==='select').props.onChange({target:{value:'successor'}});
 tree=render();assert.equal(tree.filter(n=>n.type==='label').length,4);
 assert.ok(!tree.some(n=>n.type==='label'&&n.props.title==='Concrete'));
 tree.find(n=>n.type==='input'&&n.props['aria-label']==='Search dependency tasks').props.onChange({target:{value:'Footings'}});
 tree=render();assert.equal(tree.filter(n=>n.type==='label').length,1);
 tree.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange();
 tree=render();assert.equal(tree.find(n=>n.props?.name==='successorRowKeys').props.value,'["task:1"]');
 tree.find(n=>n.type==='select').props.onChange({target:{value:'predecessor'}});
 tree=render();assert.equal(tree.filter(n=>n.type==='label').length,4);
 assert.ok(!tree.some(n=>n.type==='label'&&n.props.title==='Footings'));
 assert.ok(!tree.some(n=>n.type==='input'&&n.props.disabled));
 assert.equal(tree.find(n=>n.props?.name==='successorRowKeys').props.value,'["task:1"]');
});


test('checklist actions send all typed links with conflict baselines and checkpoint only successful saves',async()=>{
 const calls=[],events=[];let error=null;
 const actions=compile('./actions.ts',{
  '@/lib/projects/revalidate':{revalidateProjectPaths:()=>events.push('refresh')},
  '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push([name,plain(args)]);return{error};}})},
  '@/lib/auth/project-access':{requireProjectAccess:async()=>({id:'pm'})},
  '@/lib/cost-estimate/undo-redo':{recordGanttCheckpoint:async()=>events.push('checkpoint')},'./other-cost-lines':{},
 });
 const fields=form({dependenciesField:'1',predecessorRowKeys:'["category:1","task:2"]',successorRowKeys:'["task:4","task:3"]',previousPredecessorRowKeys:'[]',previousSuccessorRowKeys:'["task:4"]'});
 assert.equal((await actions.updateSubtask(1,7,{},fields)).success,true);
 assert.equal(calls[0][0],'save_estimate_dependencies');
 assert.deepEqual(calls[0][1].p_predecessors,['category:1','task:2']);
 assert.deepEqual(calls[0][1].p_successors,['task:4','task:3']);
 assert.deepEqual(calls[0][1].p_previous_successors,['task:4']);
 assert.deepEqual(events,['checkpoint','refresh']);
 error={code:'40001',message:'Dependencies changed while this form was open.'};
 assert.match((await actions.updateSubtask(1,7,{},fields)).error,/changed/);assert.equal(events.length,2);
 fields.set('successorRowKeys','["wrong:5"]');assert.ok((await actions.updateSubtask(1,7,{},fields)).error);assert.equal(calls.length,2);
});
