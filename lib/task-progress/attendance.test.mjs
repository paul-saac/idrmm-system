import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const model={};
runInNewContext(ts.transpileModule(readFileSync(new URL('./attendance.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:model,console,Map,Set});
const workers=[{id:1,full_name:'Carpenter',category:'skilled',employment_type:'employee',hourly_rate:100},
 {id:2,full_name:'Subcontractor',category:'skilled',employment_type:'subcontractor',hourly_rate:null}];
function fixture(elsewhere=0){
 let ids;
 return {get ids(){return ids;},client:{from(){return{select(){return this;},in:async()=>({data:workers,error:null})};},
 rpc:async(_name,args)=>{ids=args.p_worker_ids;return{data:elsewhere?[{worker_id:1,hours:elsewhere,item_name:'Another task'}]:[],error:null};}}};
}
const resolve=(client,rows)=>model.resolveAttendance(client,rows,'2026-11-04',{taskId:1});

test('mixed hourly attendance and fixed daily amounts produce one exact labor total',async()=>{
 const f=fixture();const result=await resolve(f.client,[{workerId:1,hours:8},{workerId:2,hours:0,amount:1500}]);
 assert.equal(result.laborCost,2300);assert.deepEqual(Array.from(f.ids),[1]);
 assert.equal(result.rows[0].hourly_rate,100);assert.equal(result.rows[0].fixed_amount,undefined);
 assert.equal(result.rows[1].hours,0);assert.equal(result.rows[1].hourly_rate,0);assert.equal(result.rows[1].fixed_amount,1500);
});
test('subcontractor-only logs do not invent hours or call hourly attendance checks',async()=>{
 const f=fixture();const result=await resolve(f.client,[{workerId:2,hours:0,amount:1250.50}]);
 assert.equal(result.laborCost,1250.50);assert.equal(f.ids,undefined);
});
test('invalid amounts, duplicate workers, hourly amounts and subcontractor hours cannot save',async()=>{
 for(const rows of [
  [{workerId:2,hours:8}], [{workerId:2,hours:8,amount:1000}],
  ...[-1,0,Infinity,NaN,1e12].map(amount=>[{workerId:2,hours:0,amount}]),
  [{workerId:1,hours:0,amount:1000}],
  [{workerId:2,hours:0,amount:1000},{workerId:2,hours:0,amount:1000}],
 ])assert.ok((await resolve(fixture().client,rows)).error);
 assert.ok((await resolve(fixture(20).client,[{workerId:1,hours:8},{workerId:2,hours:0,amount:1000}])).error);
});
