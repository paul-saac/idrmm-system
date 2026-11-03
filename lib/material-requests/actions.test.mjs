import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const compile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const validation={};runInNewContext(compile('./validation.ts'),{exports:validation});
function fixture(authorized=true){
 const writes=[];
 const client={from(table){let operation;
  const q={select(){return q;},eq(){return q;},
   insert(value){operation=value;writes.push({table,value});return q;},
   single:async()=>({data:{id:7,request_date:'2026-11-03T05:00:00Z'},error:null}),
   then(resolve){return Promise.resolve({data:table==='material_requests'?[{mr_no:'MR-002'}]:operation.map((_,i)=>({id:100+i})),error:null}).then(resolve);},
  };return q;
 }};
 const exports={};runInNewContext(compile('./actions.ts'),{exports,console,require:name=>{
  if(name==='./validation')return validation;
  if(name.includes('project-access'))return {requireProjectAccess:async()=>authorized?{id:'actor',firstName:'Trisha',lastName:'Bravo',email:'test@example.test'}:null};
  if(name.includes('supabase/server'))return {createClient:async()=>client};
  if(name.includes('revalidate'))return {revalidateProjectPaths:()=>{}};
  return {};
 }});
 const data=new FormData();data.set('dateRequired','2026-11-10');data.set('priority','urgent');
 data.set('items',JSON.stringify([{id:null,materialName:'Plywood',quantityNeeded:14,uom:'pcs',purpose:'Formwork for column',specification:'3/8 x 4ft'}]));
 return {create:()=>exports.createMaterialRequest(30,{},data),data,writes};
}
test('a complete material request saves its items and returns the real record for immediate display',async()=>{
 const f=fixture(),result=await f.create();assert.equal(result.success,true);
 assert.equal(f.writes.length,2);assert.equal(f.writes[1].value[0].material_request_id,7);
 assert.equal(result.request.id,7);assert.equal(result.request.mrNo,'MR-003');
 assert.equal(result.request.requestedByName,'Trisha Bravo');assert.equal(result.request.items[0].id,100);
 assert.equal(result.request.items[0].uom,'pcs');assert.equal(result.request.items[0].quantityRemaining,14);
});
test('missing units, blank rows and unauthorized sessions cannot create a partial request',async()=>{
 for(const patch of [{uom:''},{materialName:''},{purpose:''},{quantityNeeded:0}]){
  const f=fixture(),items=JSON.parse(f.data.get('items'));Object.assign(items[0],patch);f.data.set('items',JSON.stringify(items));
  assert.ok((await f.create()).error);assert.equal(f.writes.length,0);
 }
 const f=fixture(false);assert.ok((await f.create()).error);assert.equal(f.writes.length,0);
});
