import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';import{runInNewContext}from'node:vm';import ts from'typescript';
const require=createRequire(import.meta.url);
const jsx=(type,props)=>({type,props});
const hooks={useState:value=>[typeof value==='function'?value():value,()=>{}],useId:()=> 'test-id',useRef:value=>({current:value}),useEffect(){},useLayoutEffect(){},useMemo:fn=>fn()};
function load(file,stubs={}){
 const exports={};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const resolve=name=>{
  if(Object.hasOwn(stubs,name))return stubs[name];
  if(name==='@/components/projects/progress/incident-records-context')return{useIncidentRecords:()=>({items:[],available:true})};
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

function mountForm(props,stubs={}){
 const state=[];let cursor=0;
 const react={...hooks,useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];},useRef(initial){return this.useState(()=>({current:initial}))[0];}};
 // React imports call hooks as plain functions, without a receiver.
 react.useRef=initial=>react.useState(()=>({current:initial}))[0];
 const Component=load('components/projects/progress/progress-tracking-modal-content.tsx',{react,...stubs}).ProgressTrackingModalContent;
 const render=()=>{cursor=0;return Component(props);};
 render();
 return{render,quantity(value){nodes(render()).find(node=>node.props?.id==='progress-quantity').props.onChange(value);},save(){return nodes(render()).find(node=>node.type==='button'&&['Save','Save changes','Saving...'].includes(text(node)));}};
}

test('subcontractors use a direct daily amount, join the labor total and remain editable after reopening',async()=>{
 const {props}=fixture();props.editingLog=null;props.progressToday={...props.progressToday,today:null,todayAttendance:[]};
 const subcontractor={id:9,fullName:'Contractor',category:'skilled',employmentType:'subcontractor',hourlyRate:null,workHours:[0,0,0,0,0,0,0]};
 props.crew=[subcontractor];props.team=[subcontractor];let saved;
 props.onSave=async input=>{saved=input;return {success:true};};
 const form=mountForm(props);
 let section=nodes(form.render()).find(node=>node.type?.name==='LaborToday');
 let table=section.type(section.props);
 assert.ok(!nodes(table).some(node=>node.props?.['aria-label']==='Hours Contractor worked today'));
 const amount=nodes(table).find(node=>node.props?.['aria-label']==="Contractor's daily subcontractor amount");
 amount.props.onChange({target:{value:'1500'}});
 section=nodes(form.render()).find(node=>node.type?.name==='LaborToday');
 assert.equal(section.props.laborToday,1500);
 await form.save().props.onClick();
 assert.equal(saved.costs.labor,1500);assert.deepEqual(plain(saved.attendance),[{workerId:9,hours:0,amount:1500}]);
 const fixedLog={...log,costs:{...log.costs,labor:1500},attendance:[{workerId:9,name:'Contractor',hours:0,rate:0,amount:1500}]};
 const editor=logEditor(fixedLog,[subcontractor]);
 assert.equal(editor.workers[0].employmentType,'subcontractor');
 props.editingLog=editor.log;props.crew=editor.crew;props.team=editor.workers;
 const reopened=mountForm(props);section=nodes(reopened.render()).find(node=>node.type?.name==='LaborToday');
 assert.equal(section.props.amounts[9],'1500');assert.equal(section.props.laborToday,1500);
 assert.equal(reopened.save().props.disabled,true);
});

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
 const form=mountForm(props);assert.equal(form.save().props.disabled,true);form.quantity('2');assert.equal(form.save().props.disabled,false);
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
 assert.match(details.props.children.props.icon.props.className,/size-5/);
 assert.match(text(details),/Last edited by First Editor/);
 assert.equal(details.props.children.props.headerClassName,'[&_h2]:text-base [&_p]:text-xs');
 const headerMenu=nodes(details).find(node=>node.type?.name==='LogEditHistoryMenu');assert.ok(headerMenu);
 assert.ok(nodes(details).some(node=>Array.isArray(node.props?.children)&&node.props.children.includes(headerMenu)&&text(node).includes('Last edited by')));
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


test('history progress bars show cumulative progress by work date, inherit the task color and handle missing plans',()=>{
 const {props}=fixture();props.progressColor='hsl(42 62% 66%)';
 let history=nodes(Content(props)).find(node=>node.type?.name==='OverrideHistory');
 let tree=history.type(history.props);
 const bars=nodes(tree).filter(node=>node.props?.role==='progressbar');
 assert.deepEqual(bars.map(node=>node.props['aria-valuenow']),[20,8]);
 assert.deepEqual(bars.map(node=>nodes(node).find(child=>child.props?.style?.width)?.props.style.width),['20%','8%']);
 for(const bar of bars)assert.ok(nodes(bar).some(node=>node.props?.style?.backgroundColor===props.progressColor));
 assert.ok(!text(tree).includes('Saved by'));
 props.estimatedQuantity=0;
 history=nodes(Content(props)).find(node=>node.type?.name==='OverrideHistory');tree=history.type(history.props);
 assert.equal(nodes(tree).filter(node=>node.props?.role==='progressbar').length,0);
 assert.ok(text(tree).includes('No planned quantity'));
});


test('history accumulates 88 then 20 sq.m., counts corrected versions once and excludes deleted work dates',()=>{
 const {props}=fixture();
 const first={...log,entryDate:'2026-11-03',quantityCompleted:88,createdAt:'2026-11-03T07:18:00Z'};
 const second={...log,id:2,entryDate:'2026-11-04',quantityCompleted:20,createdAt:'2026-11-04T12:58:00Z'};
 props.overrideHistory=[second,first];props.progressToday={...props.progressToday,loggedDates:[first.entryDate,second.entryDate]};
 function percentages(){const history=nodes(Content(props)).find(node=>node.type?.name==='OverrideHistory');return nodes(history.type(history.props)).filter(node=>node.props?.role==='progressbar').map(node=>node.props['aria-valuenow']);}
 assert.deepEqual(percentages().map(n=>Math.round(n*10)/10),[43.2,35.2]);
 props.overrideHistory.unshift({...first,id:3,quantityCompleted:90,createdAt:'2026-11-05T08:00:00Z'});
 assert.deepEqual(percentages(),[44,36]);
 props.progressToday.loggedDates=[second.entryDate];
 assert.equal(percentages()[0],8);
});


test('Materials Add opens stock selection without blank rows; cancel changes nothing and selection is unique with a fixed name and unit',async()=>{
 const {props}=fixture();props.editingLog=null;props.progressToday={...props.progressToday,today:null,todayAttendance:[]};
 props.materialStocks=[{key:'cement',name:'Cement',unit:'bags',balance:12},{key:'empty',name:'Empty',unit:'pcs',balance:0}];
 props.materialPrices=[{name:'Cement',unit:'bags',unitCost:210}];
 let saved;props.onSave=async input=>{saved=input;return{success:true};};
 const form=mountForm(props);
 const picker=()=>nodes(form.render()).find(node=>node.props?.title==='Select material from stock');
 const rows=()=>nodes(form.render()).filter(node=>String(node.props?.id??'').startsWith('progress-unplanned-quantity-'));
 const add=()=>nodes(form.render()).find(node=>node.props?.['aria-label']==='Add material').props.onClick();
 add();assert.equal(picker().props.open,true);assert.equal(rows().length,0);
 picker().props.onClose();assert.equal(rows().length,0);
 add();assert.deepEqual(plain(picker().props.stocks.map(row=>row.name)),['Cement']);
 const stock=props.materialStocks[0];picker().props.onSelect(stock);assert.equal(picker().props.open,false);assert.equal(rows().length,1);
 picker().props.onSelect(stock);assert.equal(rows().length,1);
 assert.ok(!nodes(form.render()).some(node=>node.props?.['aria-label']==='Select material from stock'));
 assert.ok(!nodes(form.render()).some(node=>node.type==='input'&&node.props?.value==='Cement'));
 rows()[0].props.onChange('2');form.quantity('1');await form.save().props.onClick();
 assert.deepEqual(plain(saved.unplannedMaterials),[{name:'Cement',unit:'bags',quantity:2,unitCost:210}]);
});


test('a new today log stays disabled when untouched, zero, or only an empty cost row was added',async()=>{
 const {props}=fixture();props.editingLog=null;props.progressToday={...props.progressToday,today:null,todayAttendance:[]};
 let writes=0;props.onSave=async()=>{writes++;return{success:true};};
 const form=mountForm(props);
 assert.equal(form.save().props.disabled,true);await form.save().props.onClick();
 form.quantity('0');assert.equal(form.save().props.disabled,true);
 nodes(form.render()).find(node=>node.props?.['aria-label']==='Add other cost').props.onClick();
 assert.equal(form.save().props.disabled,true);await form.save().props.onClick();assert.equal(writes,0);
 assert.ok(!text(form.render()).includes("Changes apply to today's log only."));
 form.quantity('1');assert.equal(form.save().props.disabled,false);
 form.quantity('0');assert.equal(form.save().props.disabled,true);
});


test('only the saving work date shows a spinning history marker and Saving, then returns to Saved after confirmation',()=>{
 const {props}=fixture();props.saving=true;
 let history=nodes(Content(props)).find(node=>node.type?.name==='OverrideHistory');
 let tree=history.type(history.props);
 assert.deepEqual(nodes(tree).filter(node=>node.props?.role==='status').map(text),['Saved','Saving']);
 assert.equal(nodes(tree).filter(node=>node.props?.className?.includes('animate-spin')).length,1);
 props.saving=false;history=nodes(Content(props)).find(node=>node.type?.name==='OverrideHistory');tree=history.type(history.props);
 assert.deepEqual(nodes(tree).filter(node=>node.props?.role==='status').map(text),['Saved','Saved']);
 assert.equal(nodes(tree).filter(node=>node.props?.className?.includes('animate-spin')).length,0);
});


test('remarks-only daily logs can be saved and become unchanged after confirmation',async()=>{
 const {props}=fixture();props.editingLog=null;props.progressToday={...props.progressToday,today:null,todayAttendance:[]};props.crew=[];props.team=[];
 let saved;props.onSave=async input=>{saved=input;return {success:true};};
 const form=mountForm(props);
 assert.equal(form.save().props.disabled,true);
 const remarks=nodes(form.render()).find(node=>node.props?.id==='progress-remarks');
 remarks.props.onChange({target:{value:'Work stopped because the area was unsafe.'}});
 assert.equal(form.save().props.disabled,false);
 await form.save().props.onClick();
 assert.equal(saved.remarks,'Work stopped because the area was unsafe.');assert.equal(saved.quantityCompletedToday,0);
 assert.equal(form.save().props.disabled,true);
});

test('log photos validate type and size, survive a failed save, and stop showing as new after success',async()=>{
 const {props}=fixture();props.editingLog=null;props.progressToday={...props.progressToday,today:null,todayAttendance:[]};props.crew=[];props.team=[];
 let saved;let fail=true;
 const uploaded={path:'1/user/photo',name:'Site.png',type:'image/png',size:100};
 props.onSave=async input=>{saved=input;return fail?{error:'Upload failed'}:{success:true,photos:[uploaded]};};
 const form=mountForm(props);
 const choose=file=>nodes(form.render()).find(node=>node.props?.['aria-label']==='Upload log photos').props.onChange({target:{files:[file],value:'selected'}});
 choose({name:'Unsupported.pdf',type:'application/pdf',size:100,lastModified:1});
 assert.match(text(form.render()),/Choose JPG, PNG, or WebP/);assert.equal(form.save().props.disabled,true);
 const file={name:'Site.png',type:'image/png',size:100,lastModified:1};choose(file);
 assert.equal(form.save().props.disabled,false);
 await form.save().props.onClick();assert.equal(saved.photoFiles[0],file);assert.equal(form.save().props.disabled,false);
 fail=false;await form.save().props.onClick();assert.equal(form.save().props.disabled,true);
 assert.ok(nodes(form.render()).find(node=>node.props?.['aria-label']==='Remove photo Site.png'));
 nodes(form.render()).find(node=>node.props?.['aria-label']==='Remove photo Site.png').props.onClick();
 // Removing evidence is a change, but an otherwise empty new day stays invalid.
 assert.equal(form.save().props.disabled,true);
});

test('saved remarks and photos prefill the selected historical log',()=>{
 const {props}=fixture();props.editingLog={...props.editingLog,remarks:'Inspection completed.',photos:[{path:'1/user/photo',name:'Inspection.jpg',type:'image/jpeg',size:100}]};
 const form=mountForm(props);
 assert.equal(nodes(form.render()).find(node=>node.props?.id==='progress-remarks').props.value,'Inspection completed.');
 assert.ok(nodes(form.render()).find(node=>node.props?.['aria-label']==='Remove photo Inspection.jpg'));
 assert.equal(form.save().props.disabled,true);
});


test('history actions are available immediately after confirmation without refreshed project props',()=>{
 const {props,current}=fixture();props.editingLog=null;props.onDeleteOverride=async()=>({success:true});
 props.saving=true;props.savingDate=current.entryDate;
 props.overrideHistory=[{...current,id:-99},log];
 const render=()=>{const h=nodes(Content(props)).find(n=>n.type?.name==='OverrideHistory');return h.type(h.props);};
 let tree=render();
 assert.deepEqual(nodes(tree).filter(n=>n.props?.role==='status').map(text),['Saving','Saved']);
 assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props?.title==='Edit log').length,0);
 assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props?.title==='Delete this override').length,0);
 props.saving=false;props.overrideHistory=[{...current,id:42},log];
 tree=render();
 assert.deepEqual(nodes(tree).filter(n=>n.props?.role==='status').map(text),['Saved','Saved']);
 assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props?.title==='Edit log').length,2);
 assert.equal(nodes(tree).filter(n=>n.type==='button'&&n.props?.title==='Delete this override').length,2);
});


test('task incidents open from the header in a centered modal and reporting leaves the progress draft intact',()=>{
 const {props}=fixture();props.projectId=12;props.incidentContext={kind:'task',id:7,name:'Site Clearing'};
 let progressSaves=0;props.onSave=async()=>{progressSaves++;return{success:true};};
 const form=mountForm(props);form.quantity('21');
 let tree=form.render();const incidentButton=nodes(tree).find(n=>n.props?.['aria-label']==='View task incidents');assert.ok(incidentButton);
 incidentButton.props.onClick();tree=form.render();
 let list=nodes(tree).find(n=>n.props?.title==='Incidents');assert.equal(list.props.variant,'centered');assert.equal(list.props.open,true);
 assert.ok(!text(list).includes('Reported incidents'));
 const footer=nodes(list).find(n=>n.props?.children?.some?.(child=>child?.type==='button'&&text(child)==='Report Incident'));
 assert.deepEqual(nodes(footer).filter(n=>n.type==='button').map(text),['Report Incident','Close']);
 const dialogType=list.type;nodes(list).find(n=>n.type==='button'&&text(n)==='Report Incident').props.onClick();tree=form.render();
 list=nodes(tree).find(n=>n.props?.title==='Incidents');assert.equal(list,undefined,'unmount the incident list while reporting so dialogs do not stack');
 const host=nodes(tree).find(n=>n.props?.title==='Report Incident');assert.equal(host.type,dialogType);assert.equal(host.props.open,true);
 const report=nodes(tree).find(n=>n.props?.active&&n.props?.context?.id===7);assert.ok(report);assert.equal(report.props.embedded,true,'form reuses the open dialog without restarting backdrop animation');
 report.props.onClose();tree=form.render();assert.equal(nodes(tree).find(n=>n.props?.title==='Incidents').props.open,true);
 assert.equal(nodes(tree).find(n=>n.props?.id==='progress-quantity').props.value,'21');assert.equal(progressSaves,0);
});


test('incident list opens with preloaded task records and the requested columns without a loading message',()=>{
 const {props}=fixture();props.projectId=12;props.incidentContext={kind:'task',id:7,name:'Site Clearing'};
 const row={id:42,project_id:12,task_id:7,category_id:null,incident_type:'injury',occurred_on:'2026-01-02',occurred_time:'14:30:00',created_at:'2026-01-03T13:45:00Z',reporter_name:'Site Foreman',attachments:[]};
 const form=mountForm(props,{'@/components/projects/progress/incident-records-context':{useIncidentRecords:()=>({items:[row,{...row,id:43,task_id:8,reporter_name:'Other task'}],available:true})}});
 nodes(form.render()).find(n=>n.props?.['aria-label']==='View task incidents').props.onClick();
 const list=nodes(form.render()).find(n=>n.props?.title==='Incidents');
 assert.deepEqual(nodes(list).filter(n=>n.type==='th').map(text),['Date','Incident Type','Reported Date and Time','Reported By']);
 assert.match(text(list),/Site Foreman/);assert.match(text(list),/01\/03\/2026, 9:45:00 PM/);assert.ok(!text(list).includes('2:30 PM'));assert.ok(!text(list).includes('Other task'));assert.ok(!text(list).includes('Loading incidents'));
});

test('log detail shows a compact incident summary without standalone report details or attachment previews',()=>{
 const {props}=fixture();const history=nodes(Content(props)).find(n=>n.type?.name==='OverrideHistory');
 const modal=nodes(history.type(history.props)).find(n=>n.type?.name==='SavedProgressLogModal');
 const incident={id:42,occurred_on:'2026-01-02',occurred_time:'14:30:00',created_at:'2026-01-03T13:45:00Z',incident_type:'other',reporter_name:'Site Foreman',description:'Private detailed narrative',location:'Detailed location',attachments:[{name:'evidence.jpg',type:'image/jpeg',url:'https://example.test/evidence.jpg'}],details:{kinds:['other'],otherType:'Scaffold collapse',people:[{name:'Private person'}]}};
 const tree=modal.type({...modal.props,log,versions:[log],fallbackIncidents:[incident]});
 const section=nodes(tree).find(n=>n.type==='section'&&text(n).includes('Incident reports'));
 assert.deepEqual(nodes(section).filter(n=>n.type==='th').map(text),['Date','Incident Type','Reported Date and Time','Reported By']);
 assert.match(text(section),/Scaffold collapse/);assert.match(text(section),/01\/03\/2026, 9:45:00 PM/);assert.ok(!text(section).includes('2:30 PM'));assert.match(text(section),/Site Foreman/);
 for(const hidden of ['Private detailed narrative','Detailed location','Private person','evidence.jpg','Minor','Persons involved'])assert.ok(!text(section).includes(hidden),hidden);
 assert.ok(!nodes(section).some(n=>['img','iframe','article'].includes(n.type)));
});

 test('log report renders no numeric zero for empty attachments and matches section heading sizes',()=>{
 const {props}=fixture();const history=nodes(Content(props)).find(n=>n.type?.name==='OverrideHistory');const modal=nodes(history.type(history.props)).find(n=>n.type?.name==='SavedProgressLogModal');
 const tree=modal.type({...modal.props,log:{...log,remarks:'',photos:[]},versions:[],fallbackIncidents:[]});
 const article=nodes(tree).find(n=>n.type==='article');assert.ok(nodes(article).some(n=>n.type==='dl'&&n.props.className?.includes('after:border-l')));assert.ok(!nodes(article).some(n=>n.props?.children===0||Array.isArray(n.props?.children)&&n.props.children.includes(0)));
 const headings=nodes(article).filter(n=>n.type==='h4');for(const heading of headings)assert.match(heading.props.className,/text-xs/);
 const breakdown=nodes(article).find(n=>n.type?.name==='OverrideLogDetails');for(const heading of nodes(breakdown.type(breakdown.props)).filter(n=>n.type==='h4'))assert.ok(!heading.props.className.includes('text-[13px]'));
 });

test('saved log remarks and attachment previews appear immediately above incident summaries',()=>{
 const {props}=fixture();const history=nodes(Content(props)).find(n=>n.type?.name==='OverrideHistory');const modal=nodes(history.type(history.props)).find(n=>n.type?.name==='SavedProgressLogModal');
 const photo={path:'12/user/site.jpg',name:'Site evidence.jpg',type:'image/jpeg',size:100};
 const saved={...log,remarks:'Work stopped while the area was made safe.',photos:[photo]};
 const tree=modal.type({...modal.props,projectId:12,log:saved,versions:[saved],fallbackIncidents:[]});
 const sections=nodes(tree).filter(n=>n.type==='section');const remarks=sections.findIndex(n=>text(n).includes('Remarks / Site observations'));const attachments=sections.findIndex(n=>nodes(n).some(h=>h.type==='h4'&&text(h)==='Attachments'));const incidents=sections.findIndex(n=>text(n).includes('Incident reports'));
 assert.equal(attachments,remarks+1);assert.equal(incidents,attachments+1);assert.match(text(sections[remarks]),/Work stopped while the area was made safe/);
 const preview=nodes(sections[attachments]).find(n=>n.type?.name==='LogPhoto');assert.equal(preview.props.name,photo.name);assert.match(preview.props.src,/projectId=12/);assert.match(preview.props.src,/12%2Fuser%2Fsite.jpg/);
});
