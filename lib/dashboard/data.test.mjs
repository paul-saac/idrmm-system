import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function compile(source, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require(name) {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  } });
  return exports;
}

const calculate = compile(readFileSync(new URL("../task-progress/calculate.ts", import.meta.url), "utf8"));

test("dashboard spending matches saved progress totals, including task-less phases", async () => {
  const costs = { labor: 800, material: 350, equipment: 1200, other: 50 };
  const source = readFileSync(new URL("./data.ts", import.meta.url), "utf8") + "\nexport { summarizeProject };";
  const { summarizeProject } = compile(source, {
    "@/lib/supabase/server": { createClient() { throw new Error("No legacy ledger reads expected"); } },
    "@/lib/projects/data": {},
    "@/lib/cost-estimate/data": { getCostEstimate: async (id) => {
      assert.equal(id, 7);
      return { summary: { costsToDate: costs }, categories: [
        { weight: 100, percentComplete: 25, tasks: [], plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-05" },
      ] };
    } },
    "@/lib/task-progress/calculate": calculate,
    "@/lib/equipment/data": {},
    "@/lib/workers/data": {},
  });
  const result = await summarizeProject({ id: 7, name: "Test", status: "ongoing", allocatedBudget: 5000, workingDays: [1, 2, 3, 4, 5], holidays: [] }, new Date("2026-01-03T00:00:00Z"));
  assert.equal(result.spent, 2400);
  assert.equal(result.remaining, 2600);
  assert.equal(result.progress, 25);
});
