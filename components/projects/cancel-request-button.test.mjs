import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const code=ts.transpileModule(readFileSync(new URL('./cancel-request-button.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture(kind){
 const events=[];let resolve;
 const promise=new Promise(done=>{resolve=done});
 const sync={setError:error=>events.push(['error',error]),setCanceled:(...args)=>events.push(['status',...args])};
 const action=(...args)=>{events.push(['save',...args.slice(0,2)]);return promise};
 const exports={};runInNewContext(code,{exports,Error,FormData,require:name=>{
  if(name==='react')return {useRef:value=>({current:value}),useState:value=>[value,()=>{}]};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
  if(name.includes('request-sync-context'))return {useRequestSync:()=>sync};
  if(name.includes('material-requests/actions'))return {cancelMaterialRequest:action};
  if(name.includes('equipment-requests/actions'))return {cancelEquipmentRequest:action};
  return {ProjectWriteButton:'button',ConfirmDialog:'confirm'};
 }});
 const ui=exports.CancelRequestButton({kind,requestId:12,projectId:30});
 return {confirm:ui.props.children[1].props.onConfirm,events,resolve};
}
test('material and equipment cancellation change status immediately, save once and retain canceled state on success',async()=>{
 for(const kind of ['material','equipment']){
  const f=fixture(kind),pending=f.confirm();
  assert.deepEqual(f.events.slice(0,3),[['error',null],['status',kind,12,true],['save',12,30]]);
  await f.confirm();assert.equal(f.events.filter(e=>e[0]==='save').length,1);
  f.resolve({success:true});await pending;
  assert.equal(f.events.some(e=>e[0]==='status'&&e[3]===false),false);
 }
});
test('failed cancellation restores the prior status and surfaces the server error',async()=>{
 const f=fixture('material'),pending=f.confirm();f.resolve({error:'Access was removed.'});await pending;
 assert.deepEqual(f.events.slice(-2),[['status','material',12,false],['error','Access was removed.']]);
});
