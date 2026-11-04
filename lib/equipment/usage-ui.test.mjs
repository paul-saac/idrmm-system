import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const jsx = (type, props) => ({type, props});
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value)
  ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = value => value == null ? '' : typeof value !== 'object' ? String(value)
  : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children);
function load(file, mocks={}) {
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  runInNewContext(source,{exports,require:name=>mocks[name]??{},Date,Map,Set});
  return exports;
}
const usage=load('./usage-status.ts',{'@/lib/cost-estimate/schedule-dates':load('../cost-estimate/schedule-dates.ts')});
const react={useRef:initial=>({current:initial}),useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],
  useEffect(){},useId:()=> 'equipment',useActionState:()=>[{},()=>{},false],useMemo:fn=>fn()};
const equipment={id:1,name:'Mixer',assetTag:'EQ-001',status:'assigned',currentProjectId:4,currentProjectName:'Project',
  taskAssignments:[{projectId:4,projectName:'Project',itemKey:'task-10',taskName:'Footings',kind:'planned',
    startDate:'2026-11-04',endDate:'2026-11-06',useStatus:'ongoing'}]};
const mocks={react,'lucide-react':{ChevronRight:'chevron-right'},'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'link'},
  '@/lib/equipment/usage-status':usage,'@/components/inventory/equipment-usage-badge':{EquipmentUsageBadge:'usage-badge'},
  '@/lib/equipment/actions':{updateEquipment(){},createEquipment(){}},
  '@/components/ui/modal':{ModalFooter:'footer',ModalHeaderActions:'header-actions'},'@/lib/equipment/categories':{EQUIPMENT_CATEGORIES:[]}};

test('equipment modal shows each assigned task date range and schedule badge',()=>{
  const {EquipmentForm}=load('../../components/inventory/equipment-form.tsx',mocks);
  const tree=EquipmentForm({equipment,readOnly:true});
  assert.match(text(tree),/FootingsProjectNov 4, 2026 – Nov 6, 2026/);
  assert.equal(nodes(tree).find(node=>node.type==='usage-badge'&&node.props.status==='ongoing').props.status,'ongoing');
  assert.equal(nodes(tree).filter(node=>node.type==='input').length,0);
});

test('table retains status badges without manual Return actions',()=>{
  const {EquipmentTable}=load('../../components/inventory/equipment-table.tsx',mocks);
  const tree=EquipmentTable({equipment:[equipment],selected:new Set(),onCheck(){},onEdit(){},onAssign(){},readOnly:false});
  const badge=nodes(tree).find(node=>node.type?.name==='StatusBadge');
  assert.equal(badge.type(badge.props).props.status,'assigned');
  assert.ok(!nodes(tree).some(node=>node.type?.name==='ReturnEquipmentButton'));
  assert.ok(!nodes(tree).some(node=>node.props?.['aria-label']==='Return equipment'));
  const availableTree=EquipmentTable({equipment:[{...equipment,status:'available'}],selected:new Set(),onCheck(){},onEdit(){},readOnly:false});
  assert.ok(!nodes(availableTree).some(node=>node.props?.title==='Assign to project'));
});

test('inventory filters match the displayed physical equipment status',()=>{
  let slot=0;
  const {InventoryBrowser}=load('../../components/inventory/inventory-browser.tsx',{
    ...mocks,react:{...react,useState:initial=>[slot++===1?'maintenance':typeof initial==='function'?initial():initial,()=>{}]},
    'next/navigation':{useRouter:()=>({})},'@/components/portal/portal-context':{usePortal:()=>({basePath:'/admin',isAdmin:true})},
    '@/components/inventory/equipment-table':{EquipmentTable:'equipment-table'},
  });
  const future={...equipment,id:2,status:'maintenance'};
  const tree=InventoryBrowser({equipment:[equipment,future],projects:[]});
  const table=nodes(tree).find(node=>node.type==='equipment-table');
  assert.equal(table.props.equipment.length,1);assert.equal(table.props.equipment[0].id,2);
});

test('maintenance controls are admin-only and confirmation uses the expected current status',async()=>{
  const states=[],calls=[];let cursor=0;
  const {EquipmentForm}=load('../../components/inventory/equipment-form.tsx',{
    ...mocks,react:{...react,useState(initial){const slot=cursor++;if(!(slot in states))states[slot]=typeof initial==='function'?initial():initial;
      return [states[slot],value=>{states[slot]=typeof value==='function'?value(states[slot]):value;}];}},
    '@/components/ui/confirm-dialog':{ConfirmDialog:'confirmation'},
    '@/lib/equipment/actions':{...mocks['@/lib/equipment/actions'],setEquipmentServiceStatus:async(...args)=>{calls.push(args);return{success:true};}},
  });
  const render=(readOnly=false,asset=equipment)=>{cursor=0;return EquipmentForm({equipment:asset,readOnly,onSuccess(){calls.push(['close']);}});};
  const tree=render();const button=nodes(tree).find(node=>node.type==='button'&&text(node)==='Mark for maintenance');
  assert.ok(button);
  const header=nodes(tree).find(node=>node.type==='header-actions');
  assert.ok(nodes(header).includes(button));button.props.onClick();
  const confirm=nodes(render()).find(node=>node.type==='confirmation');assert.equal(confirm.props.open,true);
  assert.match(confirm.props.message,/removes all task assignments across projects/);
  await confirm.props.onConfirm();assert.deepEqual(calls[0],[1,'assigned','maintenance']);
  assert.equal(nodes(render(true)).some(node=>node.type==='button'&&text(node)==='Mark for maintenance'),false);
  assert.ok(nodes(render(false,{...equipment,status:'maintenance'})).some(node=>node.type==='button'&&text(node)==='Mark as available'));
});


test('conflict modal displays task and dates without a manual return instruction',()=>{
 const {EquipmentConflictDialog}=load('../../components/inventory/equipment-conflict-dialog.tsx',{
  ...mocks,'@/components/ui/modal':{Modal:'modal'},
 });
 let tree=EquipmentConflictDialog({conflict:{equipment:'Truck',projectName:'La Colina',task:'Footings',startDate:'2026-11-06',endDate:'2026-11-08'},onClose(){}});
 assert.equal(tree.props.open,true);assert.equal(tree.props.variant,'centered');
 assert.match(text(tree),/Truck.*ProjectLa Colina.*Footings.*Nov 6, 2026/);
 assert.ok(nodes(tree).some(node=>node.props?.role==='alert'));
 assert.ok(nodes(tree).some(node=>node.props?.className?.includes('text-amber-600')));
 assert.ok(!text(tree).includes('return required'));
 tree=EquipmentConflictDialog({conflict:null,onClose(){}});assert.equal(tree.props.open,false);
});


test('assignment dates are labelled Planned and Completed has no extra actual-progress text',()=>{
 const {EquipmentForm}=load('../../components/inventory/equipment-form.tsx',mocks);
 const tree=EquipmentForm({equipment:{...equipment,taskAssignments:[{...equipment.taskAssignments[0],useStatus:'completed',startDate:'2026-11-09',endDate:'2026-11-10'}]},readOnly:true});
 assert.match(text(tree),/Planned dates/);assert.ok(!text(tree).includes("100% actual"));
 assert.ok(nodes(tree).some(node=>node.type==='usage-badge'&&node.props.status==='completed'));
});


test('Assign workers excludes engineers and architects from rows and mixed-group selection',async()=>{
 const presets=load('../workers/presets.ts');
 const sections=load('../workers/sections.ts',{'@/lib/workers/presets':presets});
 const states=[];let cursor=0;let saved;
 const {AssignWorkersModalContent}=load('../../components/projects/progress/assign-workers-modal-content.tsx',{
  ...mocks,react:{...react,useState(initial){const slot=cursor++;if(!(slot in states))states[slot]=typeof initial==='function'?initial():initial;
   return [states[slot],value=>{states[slot]=typeof value==='function'?value(states[slot]):value;}];}},
  '@/components/portal/portal-context':{usePortal:()=>({isAdmin:false})},
  '@/lib/workers/sections':sections,
 });
 const workers=[{id:1,fullName:'Worker',category:'skilled',employmentType:'employee'},
  {id:2,fullName:'Engineer',category:'professional',employmentType:'employee'},
  {id:3,fullName:'Contractor',category:'skilled',employmentType:'subcontractor'}];
 const render=()=>{cursor=0;return AssignWorkersModalContent({rowName:'Footings',startDate:new Date('2026-11-04'),endDate:new Date('2026-11-06'),
  workers,assignedWorkerIds:[],groups:[{id:1,name:'Mixed crew',memberIds:[1,2,3]}],onSave:async ids=>{saved=ids;return{};},onClose(){}});};
 let tree=render();
 assert.ok(!nodes(tree).some(n=>n.props?.['aria-label']==='Select Engineer'));
 assert.ok(nodes(tree).some(n=>n.props?.['aria-label']==='Select Worker'));
 assert.ok(nodes(tree).some(n=>n.props?.['aria-label']==='Select Contractor'));
 nodes(tree).find(n=>n.type==='button'&&text(n).startsWith('Mixed crew')).props.onClick();
 tree=render();await nodes(tree).find(n=>n.type==='button'&&n.props.onClick?.name==='handleSave').props.onClick();
 assert.deepEqual(Array.from(saved).sort(),[1,3]);
});


test('equipment summary cards use full inventory counts while filters omit Retired',()=>{
 let slot=0;
 const {InventoryBrowser}=load('../../components/inventory/inventory-browser.tsx',{
  ...mocks,react:{...react,useState:initial=>[slot++===1?'maintenance':typeof initial==='function'?initial():initial,()=>{}]},
  'next/navigation':{useRouter:()=>({})},'@/components/portal/portal-context':{usePortal:()=>({basePath:'/admin',isAdmin:true})},
  '@/components/admin/dashboard/stat-card':{StatCard:'stat-card'},
  '@/components/ui/filter-select':{FilterSelect:'filter-select'},
 });
 const data=[equipment,{...equipment,id:2,status:'available'},{...equipment,id:3,status:'maintenance'},{...equipment,id:4,status:'retired'}];
 const tree=InventoryBrowser({equipment:data,projects:[]});
 const cards=nodes(tree).filter(n=>n.type==='stat-card');
 assert.deepEqual(cards.map(n=>n.props.label),['Total Tools & Equipments','Assigned','Available','Maintenance']);
 assert.deepEqual(cards.map(n=>n.props.value),[4,1,1,1]);
 const filter=nodes(tree).find(n=>n.type==='filter-select');
 assert.ok(!filter.props.options.some(option=>option.value==='retired'));
});


test('catalog has Assignment status instead of a single project or activity column; modal has a folder in Assignments heading',()=>{
 const {EquipmentTable}=load('../../components/inventory/equipment-table.tsx',mocks);
 const tree=EquipmentTable({equipment:[{...equipment,lastAssignedAt:'2020-01-01T00:00:00Z',lastReturnedAt:'2021-01-01T00:00:00Z',lastTaskAssignedAt:'2026-11-04T12:00:00Z'}],selected:new Set(),onCheck(){},onEdit(){},readOnly:true});
 const headers=nodes(tree).filter(n=>n.type==='th').map(text);
 assert.ok(headers.includes('Assignment status'));assert.ok(!headers.includes('Latest Assignment'));assert.ok(!headers.includes('Assigned Project'));assert.ok(!headers.includes('Last Activity'));
 assert.ok(!text(tree).includes('2020'));assert.ok(!text(tree).includes('2021'));assert.ok(text(tree).includes("Project Footings"));
 assert.ok(nodes(tree).some(n=>n.type==='usage-badge'&&n.props.status==='ongoing'));
 const {EquipmentForm}=load('../../components/inventory/equipment-form.tsx',{...mocks,'lucide-react':{Folder:'folder-icon'}});
 const modal=EquipmentForm({equipment,readOnly:true});assert.ok(!text(modal).includes('Assigned project'));
 const heading=nodes(modal).find(n=>n.type==='h3'&&text(n)==='Assignments');assert.ok(nodes(heading).some(n=>n.type==='folder-icon'));
});


test('assignment status prioritizes ongoing work, then the next upcoming task, and omits completed work',()=>{
 const {EquipmentTable}=load('../../components/inventory/equipment-table.tsx',mocks);
 const row=(name,status,date)=>({...equipment.taskAssignments[0],taskName:name,useStatus:status,startDate:date,itemKey:name});
 const render=tasks=>EquipmentTable({equipment:[{...equipment,taskAssignments:tasks}],selected:new Set(),onCheck(){},onEdit(){},readOnly:true});
 let tree=render([row('Finished','completed','2026-11-01'),row('Next','upcoming','2026-11-05'),row('Now','ongoing','2026-11-04')]);
 assert.ok(text(tree).includes("Project Now"));assert.ok(!text(tree).includes('Project Next'));assert.ok(!text(tree).includes('Project Finished'));
 tree=render([row('Later','upcoming','2026-11-09'),row('Next','upcoming','2026-11-05')]);
 assert.ok(text(tree).includes("Project Next"));assert.ok(!text(tree).includes('Project Later'));
 tree=render([row('Finished','completed','2026-11-01')]);assert.ok(!text(tree).includes('Project Finished'));
});

test('empty task assignments have the same horizontal and vertical inset as the section content',()=>{
 const {EquipmentForm}=load('../../components/inventory/equipment-form.tsx',mocks);
 const tree=EquipmentForm({equipment:{...equipment,taskAssignments:[]},readOnly:true});
 const empty=nodes(tree).find(n=>n.type==='p'&&text(n)==='No task assignments.');
 assert.ok(empty.props.className.includes('px-6'));assert.ok(empty.props.className.includes('py-4'));
});


test('assignment text matches body typography, status sits beside it and Actions heading is visible',()=>{
 const {EquipmentTable}=load('../../components/inventory/equipment-table.tsx',mocks);
 const tree=EquipmentTable({equipment:[equipment],selected:new Set(),onCheck(){},onEdit(){},readOnly:false});
 const assignment=nodes(tree).find(n=>n.type==='td'&&text(n).includes('Project Footings'));
 assert.ok(!assignment.props.className.includes('text-xs'));assert.ok(assignment.props.className.includes('text-zinc-600'));
 const line=nodes(assignment).find(n=>n.type==='div'&&n.props.className?.includes('items-center'));
 assert.ok(!line.props.className.includes('justify-between'));
 const separator=nodes(line).find(n=>n.type==='chevron-right');
 assert.ok(separator.props.className.includes('text-zinc-400'));
 assert.equal(separator.props['aria-hidden'],'true');
 const heading=nodes(tree).find(n=>n.type==='th'&&text(n)==='Actions');
 assert.ok(heading);assert.ok(!nodes(heading).some(n=>n.props?.className?.includes('sr-only')));
});


test('maintenance equipment has no visible task list or assignment status even with stale allocations',()=>{
 const asset={...equipment,status:'maintenance'};
 const {EquipmentForm}=load('../../components/inventory/equipment-form.tsx',mocks);
 const modal=EquipmentForm({equipment:asset,readOnly:true});
 assert.ok(!text(modal).includes('Footings'));
 assert.match(text(modal),/No task assignments/);
 const {EquipmentTable}=load('../../components/inventory/equipment-table.tsx',mocks);
 const table=EquipmentTable({equipment:[asset],selected:new Set(),onCheck(){},onEdit(){},readOnly:true});
 assert.ok(!text(table).includes('Footings'));
 assert.ok(!nodes(table).some(n=>n.type==='usage-badge'&&n.props.status==='ongoing'));
});


test('equipment Name chevron toggles alphabetical row order',()=>{
 let ascending=true;
 const {EquipmentTable}=load('../../components/inventory/equipment-table.tsx',{...mocks,react:{...react,useState:()=>[ascending,update=>{ascending=update(ascending);}]}});
 const render=()=>EquipmentTable({equipment:[{...equipment,id:1,name:'Zebra'},{...equipment,id:2,name:'Alpha'}],selected:new Set(),onCheck(){},onEdit(){},readOnly:true});
 let tree=render();
 const rows=tree=>nodes(tree).filter(n=>n.type==='tr'&&n.props['aria-label']).map(n=>n.props['aria-label']);
 assert.deepEqual(rows(tree),['View Alpha','View Zebra']);
 nodes(tree).find(n=>n.type==='button'&&text(n)==='Name').props.onClick();
 tree=render();assert.deepEqual(rows(tree),['View Zebra','View Alpha']);
 assert.equal(nodes(tree).find(n=>n.type==='th'&&n.props['aria-sort']).props['aria-sort'],'descending');
});


for(const failure of [false,true]) test(`equipment deletion hides rows and updates counts immediately, ${failure?'restoring on failure':'remaining hidden through stale refreshes'}`,async()=>{
 let cursor=0,finish,calls=0,refreshes=0;const slots=[];
 const hooks={...react,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}};
 const {InventoryBrowser}=load('../../components/inventory/inventory-browser.tsx',{
  ...mocks,react:hooks,'next/navigation':{useRouter:()=>({refresh(){refreshes++;}})},
  '@/components/portal/portal-context':{usePortal:()=>({basePath:'/admin',isAdmin:true})},
  '@/components/admin/dashboard/stat-card':{StatCard:'stat-card'},
  '@/components/inventory/equipment-table':{EquipmentTable:'equipment-table'},
  '@/components/ui/confirm-dialog':{ConfirmDialog:'confirm'},
  '@/lib/equipment/actions':{deleteEquipmentItems:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}},
 });
 const render=()=>{cursor=0;return InventoryBrowser({equipment:[equipment],projects:[]});};
 let tree=render();nodes(tree).find(n=>n.type==='equipment-table').props.onDelete(equipment);
 tree=render();const confirm=nodes(tree).find(n=>n.type==='confirm').props.onConfirm;
 const pending=confirm();await confirm();assert.equal(calls,1);
 tree=render();assert.ok(!nodes(tree).some(n=>n.type==='equipment-table'));
 assert.equal(nodes(tree).find(n=>n.type==='stat-card').props.value,0);
 assert.equal(nodes(tree).find(n=>n.type==='confirm').props.open,false);
 finish(failure?{error:'Delete rejected'}:{success:true});await pending;
 tree=render();assert.equal(nodes(tree).some(n=>n.type==='equipment-table'),failure);
 assert.equal(nodes(tree).find(n=>n.type==='stat-card').props.value,failure?1:0);
 assert.equal(refreshes,failure?0:1);
 if(failure) assert.match(text(tree),/Delete rejected/);
});


test('cross-project equipment summaries show project names without an unauthorized project link',()=>{
 const {EquipmentForm}=load('../../components/inventory/equipment-form.tsx',mocks);
 const tree=EquipmentForm({equipment:{...equipment,taskAssignments:equipment.taskAssignments.map(task=>({...task,canViewProject:false}))},readOnly:true});
 assert.match(text(tree),/FootingsProject/);
 assert.ok(!nodes(tree).some(n=>n.type==='link'||n.props?.href==='/admin/projects/4'));
});
