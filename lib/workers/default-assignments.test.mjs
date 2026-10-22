import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("project management defaults on every row; workers can belong to multiple tasks", async () => {
  const tables = {
    projects: [{id:1,project_manager_id:"pm",foreman_id:"fm"}],
    workers: [{id:10,profile_id:"pm"},{id:11,profile_id:"fm"},{id:12,profile_id:"other"}],
    estimate_tasks: [{id:1,project_id:1},{id:2,project_id:1},{id:3,project_id:1}],
    estimate_categories: [{id:4,project_id:1}],
    task_worker_assignments: [{task_id:1,worker_id:20},{task_id:2,worker_id:20},{task_id:1,worker_id:10}],
    category_worker_assignments: [],
  };
  const client = { from(table) {
    let rows = tables[table];
    return {
      select() {return this;},
      eq(key,value) {rows=rows.filter(row=>row[key]===value);return this;},
      in(key,values) {rows=rows.filter(row=>values.includes(row[key]));return this;},
      single() {return Promise.resolve({data:rows[0],error:null});},
      then(resolve,reject) {return Promise.resolve({data:rows,error:null}).then(resolve,reject);},
    };
  }};
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL("./data.ts",import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText;
  runInNewContext(code,{exports,require:(name)=>name.includes("supabase/server")?{createClient:async()=>client}:{}});
  const tasks=JSON.parse(JSON.stringify(await exports.listTaskWorkerAssignments(1)));
  assert.deepEqual(tasks,{1:[10,11,20],2:[10,11,20],3:[10,11]});
  const phases=JSON.parse(JSON.stringify(await exports.listCategoryWorkerAssignments(1)));
  assert.deepEqual(phases,{4:[10,11]});
  tables.projects[0].project_manager_id="other";
  assert.deepEqual(Array.from(await exports.listProjectManagementWorkerIds(1)),[11,12]);
});
