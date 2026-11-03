import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const model={};runInNewContext(ts.transpileModule(readFileSync(new URL('./schedule-delete-selection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:model});
const select=keys=>JSON.parse(JSON.stringify(model.scheduleDeleteSelection([
 {id:1,name:'Mobilization',tasks:[]},
 {id:2,name:'Earthworks',tasks:[{id:11},{id:12}]},
 {id:3,name:'Concrete Works',tasks:[{id:21},{id:22}]},
],new Set(keys))));
test('deleting every imported work item includes its main tasks, leaving no empty headings',()=>{
 assert.deepEqual(select(['phase-1','11','12','21','22']),{taskIds:[11,12,21,22],categoryIds:[1,2,3]});
});
test('partial selection retains its main task and unselected groups',()=>{
 assert.deepEqual(select(['11','21']),{taskIds:[11,21],categoryIds:[]});
 assert.deepEqual(select(['11','12']),{taskIds:[11,12],categoryIds:[2]});
});
