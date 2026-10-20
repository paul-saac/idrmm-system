import test from "node:test";
import assert from "node:assert/strict";
import { buildCloseoutWork, buildCloseoutMonths, dayVariance, isDateOnly } from "./closeout-model.ts";
import { summarizeProgressExpenses } from "../expenses/progress.ts";

const entry = (id, itemKey, entryDate, costs) => ({ id, itemKey, entryDate, itemName: itemKey, savedByName: null, costs: { material: 0, equipment: 0, labor: 0, other: 0, ...costs } });

test("counts leaf tasks and standalone phases once, and uses only logged actual costs", () => {
  const categories = [
    { id: 1, name: "Earthworks", percentComplete: 99, categoryLaborEstimate: 999, tasks: [
      { id: 2, name: "Excavation", plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-03", isMilestone: true, percentComplete: 60, totalEstimateCost: 1000, costsToDate: { labor: 900 } },
    ] },
    { id: 3, name: "Mobilization", tasks: [], plannedStartDate: null, plannedEndDate: null, isMilestone: false, percentComplete: 100, categoryMaterialEstimate: 100, categoryLaborEstimate: 200, categoryEquipmentEstimate: 300, categoryOtherEstimate: 50 },
  ];
  const work = buildCloseoutWork(categories, [
    entry("1", "task-2", "2026-01-01", { labor: 0.1, material: 0.2 }),
    entry("2", "task-2", "2026-01-02", { equipment: 5 }),
    entry("3", "category-3", "2026-01-02", { other: 7 }),
    entry("4", "category-1", "2026-01-02", { labor: 10 }),
  ]);
  assert.equal(work.length, 2);
  assert.equal(work[0].logged, 5.3);
  assert.equal(work[0].percent, 60);
  assert.equal(work[0].milestone, true);
  assert.equal(work[1].planned, 650);
  assert.equal(work[1].logged, 7);
});

test("all four expense categories and parent-phase entries reconcile across years", () => {
  const entries = [
    entry("1", "task-2", "2027-01-02", { material: 3.21, labor: 1.1 }),
    entry("2", "category-1", "2026-01-01", { equipment: 2.2, other: 0.1 }),
    entry("3", "category-3", "2026-01-03", { other: 0.2 }),
  ];
  const months = buildCloseoutMonths(entries);
  assert.deepEqual(months.map((month) => month.monthKey), ["2026-01", "2027-01"]);
  assert.notEqual(months[0].label, months[1].label);
  assert.equal(months[0].other, 0.3);
  const totalCents = months.reduce((sum, month) => sum + Math.round((month.material + month.equipment + month.labor + month.other) * 100), 0);
  assert.equal(totalCents, 681);
  assert.equal(summarizeProgressExpenses(entries).total, totalCents / 100);
  assert.deepEqual(buildCloseoutMonths([]), []);
  assert.deepEqual(buildCloseoutWork([], []), []);
});

test("variance uses confirmed dates, including leap days, rather than progress percentages", () => {
  assert.equal(dayVariance("2026-01-01", null), null);
  assert.equal(dayVariance(null, "2026-01-01"), null);
  assert.equal(dayVariance("2026-01-01", "2026-01-01"), 0);
  assert.equal(dayVariance("2026-01-03", "2026-01-01"), -2);
  assert.equal(dayVariance("2024-02-28", "2024-03-01"), 2);
  assert.equal(isDateOnly("2026-02-29"), false);
  assert.equal(isDateOnly("2024-02-29"), true);
  assert.equal(isDateOnly("2026-13-01"), false);
  assert.equal(isDateOnly("2026-02-30"), false);
  assert.equal(isDateOnly("not-a-date"), false);
});
