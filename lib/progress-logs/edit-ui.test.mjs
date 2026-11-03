import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';import{runInNewContext}from'node:vm';import ts from'typescript';
const require=createRequire(import.meta.url);
const jsx=(type,props)=>({type,props});
const hooks={useState:value=>[typeof value==='function'?value():value,()=>{}],useId:()=> 'test-id',useRef:value=>({current:value}),useEffect(){},useLayoutEffect(){},useMemo:fn=>fn()};
function load(file,stubs={}){
 const exports={};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const resolve=name=>{
  if(Object.hasOwn(stubs,name))return stubs[name];
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
  if(name==='next/navigation')return{useRouter:()=>({refresh(){}})};
  if(name==='server-only'||name==='next/image'||name==='lucide-react'||name.startsWith('@/components/')||name.endsWith('/actions')||name.endsWith('/purchase-actions')||name.endsWith('-modal')||name.endsWith('-panel'))return{};
  if(name.startsWith('@/'))return load(path.resolve(name.slice(2)+'.ts'));
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name)+'.ts');
  return require(name);
 };
 runInNewContext(code,{exports,require:resolve,console,Date,Map,Set,Intl},{filename:file});return exports;
}
const {ProgressTrackingModalContent:Content}=load('components/projects/progress/progress-tracking-modal-content.tsx');
const {logEditor}=load('lib/progress-logs/edit-model.ts');
const {projectProgressLog,dayEntry}=load('lib/progress-logs/optimistic.ts');
const calc=load('lib/task-progress/calculate.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const log={id:1,action:'saved',entryDate:'2026-01-02',createdAt:'2026-01-02T08:00:00Z',savedByName:'Original Author',savedByRole:'Project Manager',quantityCompleted:20,costs:{labor:100,material:0,equipment:40,other:10},
 materialsUsed:[{name:'Sand',unit:'cu.m',quantity:2}],attendance:[{name:'Legacy Worker',hours:1,rate:100}],equipmentCosts:[{name:'Mixer',amount:40}],otherCosts:[{name:'Delivery',amount:10,unplanned:true}]};
const nodes=value=>{
 if(!value||typeof value!=='object')return[];
 if(Array.isArray(value))return value.flatMap(nodes);
 return [value,...nodes(value.props?.children)];
};
const text=value=>value==null?'':typeof value==='string'||typeof value==='number'?String(value):Array.isArray(value)?value.map(text).join(''):text(value.props?.children);
function fixture(){
 const editor=logEditor(log,[]);const current={...log,id:2,entryDate:'2026-01-03',createdAt:'2026-01-03T08:00:00Z',quantityCompleted:30,attendance:[],materialsUsed:[]};
 let progress=projectProgressLog(undefined,[],log.entryDate,log,'2026-01-03').progress;
 progress=projectProgressLog(progress,[log],current.entryDate,current,'2026-01-03').progress;
 return {editor,current,props:{estimatedQuantity:250,unit:'sq.m.',plannedStartDate:'2026-01-01',plannedEndDate:'2026-01-10',plannedCosts:{labor:1000,material:0,equipment:100,other:50},
  plannedMaterials:[{key:calc.materialKey('Sand','cu.m'),name:'Sand',unit:'cu.m',plannedQuantity:10,plannedValue:0}],plannedEquipmentCosts:[{key:calc.otherCostKey('Mixer'),name:'Mixer',plannedAmount:100}],plannedOtherCosts:[],
  workingDays:[1,2,3,4,5,6],holidays:[],progressToday:progress,overrideHistory:[current,log],editingLog:editor.log,crew:editor.workers,team:editor.workers,projectName:'Fixture',onClose(){},onSave:async()=>({success:true}),onEditHistory(){}}};
}

function mountForm(props){
 const state=[];let cursor=0;
 const react={...hooks,useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];},useRef(initial){return this.useState(()=>({current:initial}))[0];}};
 // React imports call hooks as plain functions, without a receiver.
 react.useRef=initial=>react.useState(()=>({current:initial}))[0];
 const Component=load('components/projects/progress/progress-tracking-modal-content.tsx',{react}).ProgressTrackingModalContent;
 const render=()=>{cursor=0;return Component(props);};
 render();
 return{render,quantity(value){nodes(render()).find(node=>node.props?.id==='progress-quantity').props.onChange(value);},save(){return nodes(render()).find(node=>node.type==='button'&&['Save','Save changes','Saving...'].includes(text(node)));}};
}

test('selecting a saved log prefills its quantity, historical labor, materials and costs rather than today’s values',async()=>{
 const {props}=fixture();let submitted;
 props.onSave=async input=>{submitted=input;return{error:'Hold test form open'};};
 const form=mountForm(props),tree=form.render(),all=nodes(tree);
 assert.equal(all.find(node=>node.props?.id==='progress-quantity').props.value,'20');
 assert.match(text(tree),/Jan 2, 2026 log/);assert.equal(tree.props['data-progress-summary-collapsed'],'false');
 form.quantity('21');const save=form.save();
 await save.props.onClick();
 assert.equal(submitted.quantityCompletedToday,21);assert.equal(submitted.costs.labor,100);
 assert.deepEqual(plain(submitted.attendance),[{workerId:-1,hours:1}]);
 assert.deepEqual(plain(submitted.materialsUsed),[{name:'Sand',unit:'cu.m',quantity:2}]);
 assert.equal(submitted.equipmentCostsUsed[0].amount,40);assert.equal(submitted.unplannedOtherCosts[0].amount,10);
});

test('saving today or a historical correction keeps the progress modal open; a correction returns to today only after success',async()=>{
 for(const editing of [false,true])for(const backgroundSync of [false,true]){
  const {props}=fixture();let closed=0,selection='unchanged',saved=0;
  props.editingLog=editing ? props.editingLog : null;props.backgroundSync=backgroundSync;
  props.onClose=()=>{closed++;};props.onEditHistory=value=>{selection=value;};
  props.onSave=async()=>{saved++;return{success:true};};
  const form=mountForm(props);form.quantity('31');const save=form.save();
  await save.props.onClick();assert.equal(saved,1);assert.equal(closed,0);assert.equal(selection,editing ? null : 'unchanged');
 }
 const {props}=fixture();let selection='unchanged',closed=0;
 props.onSave=async()=>({error:'Save failed'});props.onEditHistory=value=>{selection=value;};props.onClose=()=>{closed++;};
 const form=mountForm(props);form.quantity('21');await form.save().props.onClick();
 assert.equal(selection,'unchanged');assert.equal(closed,0);
});

test('unchanged today and historical logs cannot be saved; editing then reverting restores the disabled Save button',async()=>{
 for(const editing of [false,true]){
  const {props}=fixture();if(!editing)props.editingLog=null;
  let writes=0;props.onSave=async()=>{writes++;return{success:true};};
  const form=mountForm(props);assert.equal(form.save().props.disabled,true);
  await form.save().props.onClick();assert.equal(writes,0);
  const original=nodes(form.render()).find(node=>node.props?.id==='progress-quantity').props.value;
  form.quantity('31');assert.equal(form.save().props.disabled,false);
  form.quantity(`${original}.00`);assert.equal(form.save().props.disabled,true);
  await form.save().props.onClick();assert.equal(writes,0);
 }
});

test('Save stays busy until completion, blocks rapid duplicate clicks and unchanged repeats, and recovers after a failed save',async()=>{
 const {props}=fixture();props.editingLog=null;props.progressToday={...props.progressToday,today:null,todayAttendance:[]};
 let finish,writes=0;props.onSave=()=>{writes++;return new Promise(resolve=>{finish=resolve;});};
 const form=mountForm(props);assert.equal(form.save().props.disabled,false);
 const originalSave=form.save();const first=originalSave.props.onClick();
 assert.equal(form.save().props['aria-busy'],true);assert.equal(text(form.save()),'Saving...');assert.equal(form.save().props.disabled,true);
 await originalSave.props.onClick();assert.equal(writes,1);
 finish({success:true});await first;
 // Even a stale event handler cannot write the exact saved snapshot twice.
 await originalSave.props.onClick();assert.equal(writes,1);assert.equal(form.save().props.disabled,true);
 form.quantity('1');assert.equal(form.save().props.disabled,false);
 const retry=form.save().props.onClick();finish({error:'Server rejected save'});await retry;
 assert.equal(form.save().props['aria-busy'],false);assert.equal(form.save().props.disabled,false);
 assert.match(text(form.render()),/Server rejected save/);
 props.onSave=async()=>{throw new Error('Offline');};await form.save().props.onClick();
 assert.equal(form.save().props.disabled,false);assert.match(text(form.render()),/Your entered values are still here/);
 props.saving=true;assert.equal(form.save().props.disabled,true);assert.equal(text(form.save()),'Saving...');
});

test('history Edit toggles to Cancel beside Delete and keeps its selected card highlighted in system black',()=>{
 const {props}=fixture();let chosen;
 props.onEditHistory=row=>{chosen=row;};props.onDeleteOverride=async()=>({success:true});
 const history=nodes(Content(props)).find(node=>node.type?.name==='OverrideHistory');
 const tree=history.type(history.props),all=nodes(tree);
 const edit=all.find(node=>node.props?.['aria-label']==='Cancel editing Jan 2, 2026 log');
 assert.equal(edit.props['aria-pressed'],true);edit.props.onClick();assert.equal(chosen,null);
 assert.ok(all.some(node=>node.props?.className?.split(/\s+/).includes('border-zinc-900')&&!node.props.className.includes('ring-1')));
 const controls=all.find(node=>node.type==='div'&&node.props?.children?.[0]===edit);
 assert.equal(controls.props.children[1].type,'button');assert.match(controls.props.children[1].props['aria-label'],/Delete/);
 assert.ok(!nodes(Content(props)).some(node=>node.type==='button'&&text(node)==='Cancel edit'));
 props.editingLog=null;
 const inactive=nodes(Content(props)).find(node=>node.type?.name==='OverrideHistory');
 const start=nodes(inactive.type(inactive.props)).find(node=>node.props?.['aria-label']==='Edit Jan 2, 2026 log');
 start.props.onClick();assert.equal(chosen.id,1);
});

test('canceling a history edit preserves the open summary across the form remount, while a fresh modal starts collapsed',()=>{
 const state=[];let cursor=0;
 const parentHooks={...hooks,useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];}};
 const {ProgressTrackingModal:Parent}=load('components/projects/progress/progress-tracking-modal.tsx',{
  react:parentHooks,'./progress-log-sync':{useProgressLogSync:()=>null},
  '@/components/portal/portal-context':{usePortal:()=>({isAdmin:true,user:{name:'Admin'}})},
  './progress-tracking-modal-content':{ProgressTrackingModalContent:Content},
  '@/lib/progress-logs/edit-actions':{},
 });
 const {props}=fixture();const task={id:1,name:'Fixture task',materialAssignments:[],...props};
 const parentProps={target:{kind:'task',task},projectId:1,projectName:'Fixture',categories:[],workingDays:props.workingDays,holidays:[],taskProgressToday:{1:props.progressToday},categoryProgressToday:{},overrideHistory:{'task-1':[log]},onClose(){}};
 const render=()=>{cursor=0;return nodes(Parent(parentProps)).find(node=>node.type===Content);};
 let form=render();assert.equal(Content(form.props).props['data-progress-summary-collapsed'],'true');
 form.props.onSummaryCollapsedChange(false);form=render();
 form.props.onEditHistory(log);form=render();assert.equal(form.props.editingLog.id,log.id);
 const history=nodes(Content(form.props)).find(node=>node.type?.name==='OverrideHistory');
 nodes(history.type(history.props)).find(node=>node.props?.['aria-label']==='Cancel editing Jan 2, 2026 log').props.onClick();
 form=render();assert.equal(form.props.editingLog,null);
 assert.equal(Content(form.props).props['data-progress-summary-collapsed'],'false');
 form.props.onSummaryCollapsedChange(true);form=render();assert.equal(Content(form.props).props['data-progress-summary-collapsed'],'true');
 form.props.onClose();form=render();assert.equal(Content(form.props).props['data-progress-summary-collapsed'],'true');
});

test('every project editor gets history Edit, only admin portals get Delete, and read-only records get neither',()=>{
 let isAdmin=false;
 const {ProgressTrackingModal:Parent}=load('components/projects/progress/progress-tracking-modal.tsx',{
  './progress-log-sync':{useProgressLogSync:()=>null},
  '@/components/portal/portal-context':{usePortal:()=>({isAdmin,user:{name:'Fixture'}})},
  './progress-tracking-modal-content':{ProgressTrackingModalContent:Content},
  '@/lib/progress-logs/edit-actions':{},
 });
 const {props}=fixture();const task={id:1,name:'Fixture task',materialAssignments:[],...props};
 for(const role of ['foreman','project_manager','admin','super_admin'])for(const readOnly of [false,true]){
  isAdmin=['admin','super_admin'].includes(role);
  const tree=Parent({target:{kind:'task',task},readOnly,projectId:1,projectName:'Fixture',categories:[],workingDays:props.workingDays,holidays:[],taskProgressToday:{1:props.progressToday},categoryProgressToday:{},overrideHistory:{'task-1':[log]},onClose(){}});
  const form=nodes(tree).find(node=>node.type===Content);
  assert.equal(typeof form.props.onEditHistory,!readOnly ? 'function' : 'undefined');
  assert.equal(typeof form.props.onDeleteOverride,isAdmin&&!readOnly ? 'function' : 'undefined');
 }
});

test('empty/mistaken logs still list every assigned worker without inventing hours or erasing typed labor costs',async()=>{
 const {props,editor}=fixture();
 const assigned=[{...editor.workers[0],id:5,fullName:'Assigned Worker A',hourlyRate:150},{...editor.workers[0],id:6,fullName:'Assigned Worker B',hourlyRate:200}];
 const empty={...log,attendance:[],costs:{...log.costs,labor:250}};
 const selected=logEditor(empty,assigned,assigned);props.editingLog=selected.log;props.crew=selected.crew;props.team=assigned;
 let saved;props.onSave=async input=>{saved=input;return{error:'Hold test form open'};};
 const form=mountForm(props),tree=form.render(),all=nodes(tree),labor=all.find(node=>node.type?.name==='LaborToday');
 assert.deepEqual(plain(labor.props.rows.map(row=>row.worker.id)),[5,6]);
 assert.equal(labor.props.hours[5],'');assert.equal(labor.props.hours[6],'');
 assert.equal(labor.props.laborToday,250);
 form.quantity('21');await form.save().props.onClick();
 assert.equal(saved.costs.labor,250);assert.deepEqual(plain(saved.attendance),[]);
});

test('assigned workers are merged with recorded attendance while saved hours and historical rates stay intact',()=>{
 const {props,editor}=fixture();
 const assigned=[{...editor.workers[0],id:5,fullName:'Recorded Worker',hourlyRate:999},{...editor.workers[0],id:6,fullName:'Also Assigned',hourlyRate:200}];
 const original={...log,attendance:[{workerId:5,name:'Recorded Worker',hours:1,rate:100}]};
 const selected=logEditor(original,assigned,assigned);
 props.editingLog=selected.log;props.crew=selected.crew;props.team=[...assigned.filter(row=>row.id!==5),...selected.workers];
 const labor=nodes(Content(props)).find(node=>node.type?.name==='LaborToday');
 assert.deepEqual(plain(labor.props.rows.map(row=>row.worker.id)),[5,6]);
 assert.equal(labor.props.hours[5],'1');assert.equal(labor.props.hours[6],'');
 assert.equal(labor.props.rows[0].worker.hourlyRate,100);assert.equal(labor.props.laborToday,100);
});

test('today’s form also preserves saved lump-sum labor when assigned workers have no recorded hours',async()=>{
 const {props,editor}=fixture();const assigned={...editor.workers[0],id:5,fullName:'Assigned Worker',hourlyRate:200};
 props.editingLog=null;props.crew=[assigned];props.team=[assigned];
 props.progressToday={...props.progressToday,today:dayEntry({...log,attendance:[],costs:{...log.costs,labor:250}}),todayAttendance:[]};
 let saved;props.onSave=async input=>{saved=input;return{error:'Hold test form open'};};
 const form=mountForm(props),tree=form.render(),all=nodes(tree),labor=all.find(node=>node.type?.name==='LaborToday');
 assert.equal(labor.props.rows[0].worker.id,5);assert.equal(labor.props.laborToday,250);
 form.quantity('21');await form.save().props.onClick();assert.equal(saved.costs.labor,250);
});

test('legacy attendance retains its own identity and rate without guessing a matching account',()=>{
 const {editor}=fixture();assert.equal(editor.log.attendance[0].workerId,-1);assert.equal(editor.workers[0].hourlyRate,100);
 assert.equal(log.attendance[0].workerId,undefined);
 const withId=logEditor({...log,attendance:[{...log.attendance[0],workerId:5}]},[{...editor.workers[0],id:5,hourlyRate:999}]);
 assert.equal(withId.workers[0].hourlyRate,100);assert.equal(withId.workers[0].id,5);
 assert.equal(dayEntry(log).equipmentCostSpend[calc.otherCostKey('Mixer')],40);
});

test('daily history opens the latest version, keeps edits inside its audit dropdown and refreshes an already-open record by date',()=>{
 const historyState=[],modalState=[];let state=historyState,cursor=0;
 const historyHooks={...hooks,useState(initial){const slot=cursor++,owner=state;if(!(slot in owner))owner[slot]=typeof initial==='function'?initial():initial;return[owner[slot],value=>{owner[slot]=typeof value==='function'?value(owner[slot]):value;}];}};
 const {ProgressTrackingModalContent:StatefulContent}=load('components/projects/progress/progress-tracking-modal-content.tsx',{react:historyHooks});
 const {props,current}=fixture();cursor=0;
 const component=nodes(StatefulContent(props)).find(node=>node.type?.name==='OverrideHistory');
 historyState.length=0;
 const edit={...log,id:4,createdAt:'2026-01-04T08:00:00Z',savedByName:'First Editor',quantityCompleted:25};
 const historyProps={...component.props,logs:[log,current,edit],editingLogId:undefined};
 const render=()=>{state=historyState;cursor=0;return component.type(historyProps);};
 let tree=render();
 assert.equal(nodes(tree).filter(node=>node.type==='li').length,2);
 assert.equal(nodes(tree).filter(node=>node.props?.['aria-label']==='Edit Jan 2, 2026 log').length,1);
 const cards=nodes(tree).filter(node=>node.type==='button'&&node.props.className?.includes('block w-full'));
 assert.match(text(cards[1]),/25/);cards[1].props.onClick();tree=render();
 let modal=nodes(tree).find(node=>node.type?.name==='SavedProgressLogModal');
 assert.equal(modal.props.log.id,4);assert.deepEqual(plain(modal.props.versions.map(row=>row.id)),[4,1]);
 const renderDetails=props=>{state=modalState;cursor=0;return modal.type(props);};
 let details=renderDetails(modal.props);
 assert.equal(details.props.children.props.title,'Jan 2, 2026 (Edited)');
 assert.equal(details.props.children.props.description,'Logged by Original Author');
 assert.match(details.props.children.props.icon.props.className,/size-6/);
 assert.match(text(details),/Last edited by First Editor/);
 assert.equal(details.props.children.props.headerClassName,'[&_h2]:text-base [&_p]:text-xs');
 const headerMenu=nodes(details).find(node=>node.type?.name==='LogEditHistoryMenu');assert.ok(headerMenu);
 assert.ok(nodes(details).some(node=>node.props?.children===headerMenu));
 state=[];cursor=0;const menuTree=headerMenu.type(headerMenu.props);
 assert.match(text(menuTree),/Edit history/);assert.match(text(menuTree),/Original log/);assert.match(text(menuTree),/Edit 1/);
 assert.ok(nodes(menuTree).some(node=>node.props?.popover==='auto'));
 assert.deepEqual(plain(nodes(details).filter(node=>node.type?.name==='OverrideLogDetails').map(node=>node.props.log.id)),[4]);
 const originalChoice=nodes(menuTree).find(node=>node.props?.role==='menuitemradio'&&text(node).includes('Original log'));
 originalChoice.props.onClick();details=renderDetails(modal.props);
 assert.equal(nodes(details).find(node=>node.type?.name==='OverrideLogDetails').props.log.id,1);
 assert.match(text(details),/Viewing earlier version/);
 headerMenu.props.onSelect(null);details=renderDetails(modal.props);
 assert.equal(nodes(details).find(node=>node.type?.name==='OverrideLogDetails').props.log.id,4);
 const latest={...edit,id:5,createdAt:'2026-01-05T08:00:00Z',savedByName:'Second Editor',quantityCompleted:28};
 historyProps.logs=[latest,log,current,edit];tree=render();modal=nodes(tree).find(node=>node.type?.name==='SavedProgressLogModal');
 assert.equal(modal.props.log.id,5);assert.equal(modal.props.versions.length,3);
 details=renderDetails(modal.props);
 assert.match(text(details),/Last edited by Second Editor/);
 assert.equal(nodes(details).find(node=>node.type?.name==='OverrideLogDetails').props.log.quantityCompleted,28);
 // An unedited date has no edit marker or audit dropdown.
 details=renderDetails({...modal.props,log:current,versions:[current]});
 assert.equal(details.props.children.props.title,'Jan 3, 2026');assert.ok(!nodes(details).some(node=>node.type?.name==='LogEditHistoryMenu'));
});

test('optimistic editing of an older day replaces its contribution once and leaves today’s log unchanged',()=>{
 const {props,current}=fixture();const before=plain(props.progressToday);
 const corrected={...log,id:3,createdAt:'2026-01-04T08:00:00Z',quantityCompleted:25};
 const result=projectProgressLog(props.progressToday,[current,log],log.entryDate,corrected,'2026-01-03');
 assert.equal(result.progress.cumulativeQuantityCompleted,55);assert.equal(result.progress.today.quantityCompleted,30);
 assert.equal(result.history.length,3);assert.deepEqual(plain(props.progressToday),before);
});
