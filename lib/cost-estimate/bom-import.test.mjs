import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const resources = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('../bom-import/estimate-resources.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: resources });

function setup({ startDate = "2026-10-01", projectError = null, authorized = true, rpcError = null } = {}) {
  const writes = [];
  const events = [];
  const calls = [];
  const client = {
    async rpc(name, args) { calls.push({name, args}); return { error: rpcError }; },
    from(table) {
      const query = {
        select() { return query; },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
        eq(column, value) {
          assert.equal(column, "id");
          assert.equal(value, 42);
          return query;
        },
        insert(values) { writes.push({ table, values }); return query; },
        async single() {
          return table === "projects"
            ? { data: { start_date: startDate }, error: projectError }
            : { data: { id: writes.length }, error: null };
        },
      };
      return query;
    },
  };
  const mocks = {
    "@/lib/projects/revalidate": { revalidateProjectPaths: () => events.push("refresh") },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/auth/project-access": { requireProjectAccess: async () => authorized ? { id: "user" } : null },
    "./other-cost-lines": {},
    "@/lib/bom-import/estimate-resources": resources,
    "./schedule-dates": {},
    "@/lib/cost-estimate/undo-redo": { recordGanttCheckpoint: async () => events.push("checkpoint") },
  };
  const exports = {};
  runInNewContext(code, { exports, require: (name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, console });
  return { apply: exports.applyBomImport, writes, events, calls };
}

const draft = [
  { name: "Mobilization", amount: "500", tasks: [] },
  { name: "Foundation", amount: "0", tasks: [
    { name: "Excavation", quantity: "2", unit: "lot", materials: [
      { name: "Gravel", quantity: "3", unit: "cu.m", unitCost: "100" },
    ] },
    { name: "Footings", quantity: "1", unit: "lot", materials: [] },
  ] },
];

test('confirmation sends the complete reviewed draft through one atomic RPC without separate writes',async()=>{
 const {apply,writes,calls,events}=setup();
 assert.equal((await apply(42,draft)).success,true);
 assert.equal(writes.length,0);
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,'import_reviewed_estimate');
 assert.equal(calls[0].args.p_project_id,42);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args.p_categories)),draft);
 assert.deepEqual(events,['refresh']);
});

test('a rejected transaction keeps the reviewed draft and does not report a partial save',async()=>{
 const {apply,writes,events}=setup({rpcError:{code:'23502',message:'Fixture resource rejection'}});
 const before=JSON.stringify(draft),result=await apply(42,draft);
 assert.match(result.error,/No tasks or resource details from this attempt were added/);
 assert.equal(result.success,undefined);assert.equal(writes.length,0);
 assert.equal(JSON.stringify(draft),before);assert.deepEqual(events,[]);
});

test('missing migration and denied sessions explain recovery without retrying non-atomic writes',async()=>{
 for(const code of ['PGRST202','42501','55000']){
  const {apply,writes,calls}=setup({rpcError:{code,message:'Fixture'}});
  const result=await apply(42,draft);
  assert.ok(result.error);assert.equal(writes.length,0);assert.equal(calls.length,1);
  if(code==='PGRST202')assert.match(result.error,/migration 0125/);
 }
});

test('invalid resource values are rejected before confirming',async()=>{
 for(const amount of ['-1','not a number','Infinity','1000000000000']){
  const {apply,calls}=setup();
  assert.ok((await apply(42,[{name:'Work',tasks:[],equipment:[{name:'Truck',amount}]}])).error);
  assert.equal(calls.length,0);
 }
});

for(const [name,options]of [
 ['missing project start',{startDate:null}],['project lookup failure',{projectError:{message:'Unavailable'}}],
 ['out-of-range start',{startDate:'2200-01-01'}],['unauthorized user',{authorized:false}],
])test(`AI import makes no writes for ${name}`,async()=>{
 const {apply,writes,calls}=setup(options);assert.ok((await apply(42,draft)).error);
 assert.equal(writes.length,0);assert.equal(calls.length,0);
});
