import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const model={};runInNewContext(ts.transpileModule(readFileSync(new URL('./validation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:model});
const item={materialName:'Plywood',quantityNeeded:'14',uom:'pcs',purpose:'Formwork for column'};
test('the screenshot values submit when UOM is chosen, including custom units',()=>{
 assert.equal(model.materialRequestIssue('2026-11-10',[item]),null);
 assert.equal(model.materialRequestIssue('2026-11-10',[{...item,uom:'sheets'}]),null);
});
test('missing UOM reports the precise item instead of a generic blocked submission',()=>{
 const issue=model.materialRequestIssue('2026-11-10',[{...item,uom:''}]);
 assert.equal(issue.field,'uom');assert.equal(issue.index,0);assert.match(issue.message,/unit for item 1 \(Plywood\)/);
});
test('each required field and every item is validated without silently discarding blank lines',()=>{
 for(const [patch,field]of [[{materialName:''},'name'],[{quantityNeeded:0},'qty'],[{quantityNeeded:Infinity},'qty'],[{purpose:''},'purpose']]){
  const issue=model.materialRequestIssue('2026-11-10',[item,{...item,...patch}]);assert.equal(issue.index,1);assert.equal(issue.field,field);
 }
 assert.equal(model.materialRequestIssue('',[item]).field,'dateRequired');
 assert.ok(model.materialRequestIssue('2026-11-10',[]));
});
