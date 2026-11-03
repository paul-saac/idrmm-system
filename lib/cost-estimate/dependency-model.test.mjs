import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('./dependency-model.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const{rowPredecessors,dependencyRows,dependencySelection,applyDependencySelection,hasDependencyCycle}=exports;
const fixture=()=>[{id:1,name:'Group',tasks:[{id:11,name:'First',predecessors:[]},{id:12,name:'Second',predecessors:[]}]},{id:2,name:'Standalone',tasks:[],predecessors:[]},{id:3,name:'Milestone',tasks:[],isMilestone:true,predecessors:[]}];
const plain=x=>JSON.parse(JSON.stringify(x));
test('all rows are predecessor candidates and successor candidates contain only subtasks',()=>{
 const rows=dependencyRows(fixture());assert.equal(rows.length,5);assert.equal(rows.filter(row=>row.kind==='task').length,2);
 assert.equal(rows.find(row=>row.id===3&&row.kind==='category').isMilestone,true);
 assert.equal(rows.find(row=>row.kind==='task').label,'First');assert.equal(rows.find(row=>row.kind==='task').phase,'Group');
 assert.equal(rows.find(row=>row.kind==='category'&&row.id===1).phase,'Group');
 assert.equal(rows.find(row=>row.kind==='category'&&row.id===2).phase,'');
});
test('many-to-many edits retain other predecessors and preserve all non-link values',()=>{
 const source=fixture();source[2].predecessors=[{kind:'category',id:2},{kind:'task',id:11}];const before=plain(source);
 const next=applyDependencySelection(source,{kind:'task',id:11},['category:2'],['task:12']);
 assert.equal(next[0].tasks[1].predecessors.length,1);assert.equal(next[2].predecessors.length,2);
 assert.deepEqual(plain(dependencySelection(next,{kind:'task',id:11})),{predecessors:['category:2'],successors:['task:12']});
 const removed=applyDependencySelection(next,{kind:'task',id:11},[],[]);
 assert.deepEqual(plain(removed[2].predecessors),[{kind:'category',id:2},{kind:'task',id:11}]);assert.deepEqual(plain(source),before);
});
test('cycles include group start/finish gates, while independent predecessor forks remain valid',()=>{
 const source=fixture();
 assert.equal(hasDependencyCycle(applyDependencySelection(source,{kind:'task',id:11},['category:1'],[])),true);
 assert.equal(hasDependencyCycle(applyDependencySelection(source,{kind:'category',id:1},['task:11'],[])),true);
 const next=applyDependencySelection(source,{kind:'task',id:11},['category:2','category:3'],['task:12']);assert.equal(hasDependencyCycle(next),false);
 assert.equal(hasDependencyCycle(applyDependencySelection(next,{kind:'category',id:2},['task:12'],['task:11'])),true);
});
test('canonical empty arrays clear legacy links and older row payloads still read their single link',()=>{
 assert.deepEqual(plain(rowPredecessors({predecessors:[],predecessorTaskId:11})),[]);
 assert.deepEqual(plain(rowPredecessors({predecessorTaskId:11})),[{kind:'task',id:11}]);
});
