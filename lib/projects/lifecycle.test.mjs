import { test } from "node:test";
import assert from "node:assert/strict";
import { projectLifecycle } from "./lifecycle.ts";
import { deriveProjectStatusFromProgress } from "./status.ts";
import { EMPTY_PROGRESS_ANCHOR } from "../task-progress/calculate.ts";

const work = { ...EMPTY_PROGRESS_ANCHOR, cumulativeQuantityCompleted: 1, loggedDates: ["2026-10-13"] };
const categories = (percent = 100) => [{ id: 10, percentComplete: 0, tasks: [{ id: 1, percentComplete: percent }] }];

test("empty projects and zero-work logs remain Planning, even with a stale completion date", () => {
  for (const lifecycle of [projectLifecycle([], {}, {}), projectLifecycle(categories(0), { 1: {
    ...EMPTY_PROGRESS_ANCHOR, loggedDates: ["2026-10-13"],
  } }, {})]) {
    assert.equal(lifecycle.allItemsComplete, false);
    assert.equal(deriveProjectStatusFromProgress(lifecycle, "2026-10-13"), "planning");
  }
});

test("partial work is Ongoing; 100% still requires confirmation", () => {
  assert.equal(deriveProjectStatusFromProgress(projectLifecycle(categories(20), { 1: work }, {}), null), "ongoing");
  const complete = projectLifecycle(categories(), { 1: work }, {});
  assert.equal(deriveProjectStatusFromProgress(complete, null), "ongoing");
  assert.equal(deriveProjectStatusFromProgress(complete, "2026-10-13"), "completed");
});

test("an incomplete zero-weight task blocks completion regardless of overall rounding", () => {
  const rows = categories();
  rows[0].tasks.push({ id: 2, percentComplete: 99.999 });
  const lifecycle = projectLifecycle(rows, { 1: work, 2: work }, {});
  assert.equal(lifecycle.allItemsComplete, false);
  assert.equal(deriveProjectStatusFromProgress(lifecycle, "2026-10-13"), "ongoing");
});

test("standalone phases count while parent phases do not duplicate their tasks", () => {
  const lifecycle = projectLifecycle([...categories(), { id: 11, percentComplete: 0, tasks: [] }], { 1: work }, {});
  assert.equal(lifecycle.itemCount, 2);
  assert.equal(lifecycle.allItemsComplete, false);
  assert.equal(projectLifecycle([{ id: 11, percentComplete: 100, tasks: [] }], {}, { 11: work }).allItemsComplete, true);
});

test("saved expenses or material usage start work even when quantity progress is zero", () => {
  for (const anchor of [
    { ...EMPTY_PROGRESS_ANCHOR, cumulativeCosts: { labor: 10, material: 0, equipment: 0, other: 0 } },
    { ...EMPTY_PROGRESS_ANCHOR, cumulativeMaterialUsage: { gravel: 2 } },
  ]) assert.equal(deriveProjectStatusFromProgress(projectLifecycle(categories(0), { 1: anchor }, {}), null), "ongoing");
});

test("removing recorded work reopens a completed project", () => {
  assert.equal(deriveProjectStatusFromProgress(projectLifecycle(categories(0), {}, {}), "2026-10-13"), "planning");
  assert.equal(deriveProjectStatusFromProgress(projectLifecycle(categories(50), { 1: work }, {}), "2026-10-13"), "ongoing");
});
