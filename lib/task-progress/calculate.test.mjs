import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProgressBreakdown, computeTodayPlan, EMPTY_PROGRESS_ANCHOR, ZERO_COSTS } from "./calculate.ts";

const plan = {
  plannedStartDate: "2026-10-12",
  plannedEndDate: "2026-10-16",
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  plannedCosts: { labor: 500, material: 300, equipment: 100, other: 100 },
  estimatedQuantity: 10,
  plannedMaterials: [{ key: "gravel|bag", name: "Gravel", unit: "bag", plannedQuantity: 10, plannedValue: 300 }],
  plannedEquipmentCosts: [{ key: "truck", name: "Truck", plannedAmount: 100 }],
  plannedOtherCosts: [{ key: "permit", name: "Permit", plannedAmount: 100 }],
  anchor: EMPTY_PROGRESS_ANCHOR,
  today: new Date(2026, 9, 27),
};
const saved = {
  cumulativeQuantityCompleted: 2,
  cumulativeCosts: { labor: 100, material: 60, equipment: 20, other: 20 },
  cumulativeMaterialUsage: { "gravel|bag": 2 },
  cumulativeEquipmentCostSpend: { truck: 20 },
  cumulativeOtherCostSpend: { permit: 20 },
  loggedDates: ["2026-10-12"],
};

test("past-due unlogged tasks have zero actuals and 100% Expected", () => {
  for (const dates of [{}, { plannedStartDate: "2026-10-13", plannedEndDate: "2026-10-13" }]) {
    const actual = computeProgressBreakdown({ ...plan, ...dates });
    assert.equal(actual.percentComplete, 0);
    assert.equal(actual.timePercent, 100);
    assert.equal(actual.scheduleStatus, "behind");
    assert.equal(actual.quantityToDate, 0);
    assert.equal(actual.automaticDays, 0);
    assert.deepEqual(actual.costsToDate, ZERO_COSTS);
    assert.deepEqual(actual.materialUsageToDate, {});
    assert.deepEqual(actual.equipmentCostSpendToDate, {});
    assert.deepEqual(actual.otherCostSpendToDate, {});
  }
});

test("skipped days never add to a partial saved log", () => {
  const result = computeProgressBreakdown({ ...plan, anchor: saved });
  assert.equal(result.percentComplete, 20);
  assert.equal(result.quantityToDate, 2);
  assert.deepEqual(result.costsToDate, saved.cumulativeCosts);
  assert.deepEqual(result.materialUsageToDate, saved.cumulativeMaterialUsage);
  assert.deepEqual(result.equipmentCostSpendToDate, saved.cumulativeEquipmentCostSpend);
  assert.deepEqual(result.otherCostSpendToDate, saved.cumulativeOtherCostSpend);
});

test("advancing dates changes Expected but not actual quantities or spending", () => {
  for (const [day, expected] of [[11, 0], [12, 20], [14, 60], [27, 100]]) {
    const result = computeProgressBreakdown({ ...plan, anchor: saved, today: new Date(2026, 9, day) });
    assert.equal(result.timePercent, expected);
    assert.equal(result.percentComplete, 20);
    assert.deepEqual(result.costsToDate, saved.cumulativeCosts);
  }
});

test("zero logs and removing the last log do not restore automatic progress", () => {
  for (const anchor of [EMPTY_PROGRESS_ANCHOR, { ...EMPTY_PROGRESS_ANCHOR, loggedDates: ["2026-10-12"] }]) {
    assert.equal(computeProgressBreakdown({ ...plan, anchor }).percentComplete, 0);
  }
});

test("cost and materials fallbacks use recorded values only", () => {
  const cost = computeProgressBreakdown({ ...plan, estimatedQuantity: 0, anchor: saved });
  assert.equal(cost.progressSource, "cost");
  assert.equal(cost.percentComplete, 20);
  const materials = computeProgressBreakdown({ ...plan, estimatedQuantity: 0, plannedCosts: ZERO_COSTS, anchor: saved });
  assert.equal(materials.progressSource, "materials");
  assert.equal(materials.percentComplete, 20);
});

test("unplanned material spend remains actual expense but not cost-based progress", () => {
  const result = computeProgressBreakdown({ ...plan, estimatedQuantity: 0, anchor: {
    ...saved, cumulativeCosts: { ...saved.cumulativeCosts, material: 110 }, cumulativeUnplannedMaterialCost: 50,
  } });
  assert.equal(result.costsToDate.material, 110);
  assert.equal(result.percentComplete, 20);
});

test("saved overruns are retained while progress is capped at 100", () => {
  const result = computeProgressBreakdown({ ...plan, anchor: {
    ...saved, cumulativeQuantityCompleted: 15, cumulativeCosts: { ...saved.cumulativeCosts, labor: 1500 },
  } });
  assert.equal(result.quantityToDate, 15);
  assert.equal(result.costsToDate.labor, 1500);
  assert.equal(result.percentComplete, 100);
});

test("holidays affect Expected only and a missing schedule does not erase saved actuals", () => {
  const holiday = computeProgressBreakdown({ ...plan, holidays: ["2026-10-13"], today: new Date(2026, 9, 13), anchor: saved });
  assert.equal(holiday.timePercent, 25);
  assert.equal(holiday.percentComplete, 20);
  const unscheduled = computeProgressBreakdown({ ...plan, plannedStartDate: null, plannedEndDate: null, anchor: saved });
  assert.equal(unscheduled.timePercent, null);
  assert.equal(unscheduled.percentComplete, 20);
});

test("daily baseline remains available without mutating actual totals", () => {
  const before = structuredClone(saved);
  const daily = computeTodayPlan({ ...plan, anchor: saved, today: new Date(2026, 9, 14) });
  assert.equal(daily.quantity, 2);
  assert.equal(daily.costs.labor, 100);
  assert.deepEqual(saved, before);
  assert.equal(computeProgressBreakdown({ ...plan, anchor: saved }).percentComplete, 20);
});
