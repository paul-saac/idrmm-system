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

function setup({ startDate = "2026-10-01", projectError = null, authorized = true, failTable = null } = {}) {
  const writes = [];
  const events = [];
  const calls = [];
  const client = {
    async rpc(name, args) { calls.push({name, args}); return { error: null }; },
    from(table) {
      const query = {
        select() { return query; },
        then(resolve) { return Promise.resolve({ error: table === failTable ? { message: 'Fixture resource write failure' } : null }).then(resolve); },
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

test("AI import schedules all new tasks and categories on the project start and preserves costs", async () => {
  const { apply, writes, events } = setup();
  assert.equal((await apply(42, draft)).success, true);
  const scheduled = writes.filter(({ table }) => table !== "estimate_task_material_assignments");
  assert.equal(scheduled.length, 4);
  for (const { values } of scheduled) {
    assert.equal(values.planned_start_date, "2026-10-01");
    assert.equal(values.planned_end_date, "2026-10-01");
    assert.equal(values.project_id, 42);
  }
  assert.equal(writes[0].values.material_direct_amount, 500);
  assert.equal(writes.find(({ table }) => table === "estimate_tasks").values.total_estimate_cost, 300);
  assert.deepEqual(events, ["checkpoint", "refresh"]);
});

test('mixed-resource tasks save every planned cost once, including equipment and other descriptions', async () => {
  const { apply, writes, calls } = setup();
  const data = structuredClone(draft);
  Object.assign(data[1].tasks[0], { laborEstimate: '1200', equipment: [{ name: 'Mixer rental', amount: '500' }], otherCosts: [{ name: 'Delivery fee', amount: '200' }] });
  assert.equal((await apply(42, data)).success, true);
  const task = writes.find(write => write.table === 'estimate_tasks').values;
  assert.equal(task.material_estimate, 300); assert.equal(task.labor_estimate, 1200);
  assert.equal(task.equipment_estimate, 500); assert.equal(task.other_cost_estimate, 200);
  assert.equal(task.total_estimate_cost, 2200);
  assert.equal(writes.find(write => write.table === 'estimate_task_other_costs').values[0].cost_name, 'Delivery fee');
  assert.equal(calls[0].name, 'save_equipment_cost_breakdown');
  assert.equal(calls[0].args.p_changes[0].lines[0].costName, 'Mixer rental');
  assert.equal(calls[0].args.p_changes[0].lines[0].amountOverride, 500);
});

test('standalone tasks support their own material, labor, equipment and other breakdowns', async () => {
  const { apply, writes, calls } = setup();
  const data = [{name:'Site preparation', amount:'', tasks:[], laborEstimate:'700',
    materials:[{name:'Gravel',quantity:'2',unit:'cu.m',unitCost:'100'}],
    equipment:[{name:'Truck',amount:'300'}],otherCosts:[{name:'Permit',amount:'100'}]}];
  assert.equal((await apply(42,data)).success,true);
  const row=writes[0].values;
  assert.equal(row.category_material_estimate,200);assert.equal(row.category_labor_estimate,700);
  assert.equal(row.category_equipment_estimate,300);assert.equal(row.category_other_estimate,100);
  assert.equal(writes[1].table,'estimate_category_material_assignments');
  assert.equal(writes[1].values[0].category_id,1);
  assert.equal(writes[2].values[0].category_id,1);
  assert.equal(calls[0].args.p_changes[0].kind,'category');
});

test('lump sums follow their selected cost type and never become materials accidentally', async () => {
  for(const type of ['labor','equipment','other']) {
    const {apply,writes}=setup();
    assert.equal((await apply(42,[{name:'Allowance',amount:'500',amountType:type,tasks:[]}])).success,true);
    assert.equal(writes[0].values.category_material_estimate,0);
    assert.equal(writes[0].values[`category_${type === 'other' ? 'other' : type}_estimate`],500);
  }
});

test('invalid imported costs are rejected before any project writes', async () => {
  for(const amount of ['-1','not a number','Infinity','1000000000000']) {
    const {apply,writes}=setup();
    const result=await apply(42,[{name:'Allowance',amount:'',tasks:[],equipment:[{name:'Truck',amount}]}]);
    assert.ok(result.error);assert.equal(writes.length,0);
  }
});

test('a resource write failure reports partial import instead of claiming success',async()=>{
  const {apply,writes,events}=setup({failTable:'estimate_task_other_costs'});
  const result=await apply(42,[{name:'Site preparation',amount:'',tasks:[],otherCosts:[{name:'Permit',amount:'100'}]}]);
  assert.match(result.error,/Some records are already saved/);
  assert.equal(result.success,undefined);
  assert.equal(writes.length,2);
  assert.deepEqual(events,['checkpoint','refresh']);
});

test('printed material totals are preserved when rate or quantity is absent or differs',async()=>{
  for(const [quantity,unitCost] of [['',''],['10','800']]) {
    const {apply,writes}=setup();
    assert.equal((await apply(42,[{name:'Work',amount:'',tasks:[{name:'Excavation',quantity:'',unit:'',
      materials:[{itemNo:'IV-02',name:'Gravel',quantity,unit:'cu.m',unitCost,amount:'9600'}],
    }]}])).success,true);
    const task=writes.find(write=>write.table==='estimate_tasks').values;
    assert.equal(task.material_estimate,9600);assert.equal(task.total_estimate_cost,9600);
    const material=writes.find(write=>write.table==='estimate_task_material_assignments').values[0];
    assert.equal(material.amount,9600);
    assert.equal(material.unit_cost,unitCost ? 800 : 0);
  }
});

for (const [name, options] of [
  ["missing project start", { startDate: null }],
  ["project lookup failure", { projectError: { message: "Unavailable" } }],
  ["out-of-range start", { startDate: "2200-01-01" }],
  ["unauthorized user", { authorized: false }],
]) {
  test(`AI import makes no writes for ${name}`, async () => {
    const { apply, writes, events } = setup(options);
    assert.ok((await apply(42, draft)).error);
    assert.equal(writes.length, 0);
    assert.equal(events.length, 0);
  });
}
