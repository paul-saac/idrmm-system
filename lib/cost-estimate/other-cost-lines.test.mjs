import { test } from "node:test";
import assert from "node:assert/strict";
import { otherCostAmount, validOtherCostChanges } from "./other-cost-lines.ts";

const line = { costName: "Permit fee", quantity: 2, unit: "lot", unitCost: 1500, amountOverride: null };
test("Other costs calculate quantity times rate and honor direct overrides", () => {
  assert.equal(otherCostAmount(line), 3000);
  assert.equal(otherCostAmount({ ...line, amountOverride: 2500 }), 2500);
  assert.equal(otherCostAmount({ ...line, amountOverride: 0 }), 0);
  assert.equal(otherCostAmount({ ...line, quantity: 3, unitCost: 0.1 }), 0.3);
});
test("Other costs validate owners, missing names and invalid values", () => {
  assert.equal(validOtherCostChanges([{ kind: "task", id: 1, lines: [line] }]), true);
  assert.equal(validOtherCostChanges([{ kind: "category", id: 2, lines: [] }]), true);
  for (const invalid of [{ costName: " " }, { quantity: -1 }, { unitCost: Infinity }, { amountOverride: NaN }]) {
    assert.equal(validOtherCostChanges([{ kind: "task", id: 1, lines: [{ ...line, ...invalid }] }]), false);
  }
  assert.equal(validOtherCostChanges([{ kind: "project", id: 1, lines: [line] }]), false);
  assert.equal(validOtherCostChanges(null), false);
});
