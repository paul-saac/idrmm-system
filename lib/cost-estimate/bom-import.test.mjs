import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ startDate = "2026-10-01", projectError = null, authorized = true } = {}) {
  const writes = [];
  const events = [];
  const client = {
    from(table) {
      const query = {
        select() { return query; },
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
    "@/lib/cost-estimate/undo-redo": { recordGanttCheckpoint: async () => events.push("checkpoint") },
  };
  const exports = {};
  runInNewContext(code, { exports, require: (name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, console });
  return { apply: exports.applyBomImport, writes, events };
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
