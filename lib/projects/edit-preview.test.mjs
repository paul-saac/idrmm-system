import test from "node:test";
import assert from "node:assert/strict";
import { projectEditPreview } from "./edit-preview.ts";

const original = { id: 1, name: "Before", holidays: ["2026-11-02"], status: "planning", archivedAt: null,
  projectManagerId: "pm1", projectManagerName: "First Manager", foremanId: "f1", foremanName: "First Foreman" };
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ projectName: " Updated ", location: "Marikina", allocatedBudget: "2000000.50",
    projectManagerId: "pm2", foremanId: "f2", startDate: "2026-11-01", targetEndDate: "2026-11-30", actualEndDate: "" })) data.set(key, value);
  for (const day of [1,2,3,4,5,6,7]) data.append("workingDays", String(day));
  return data;
}
test("all edited fields and lead names reflect together without touching hidden project state", () => {
  const before = structuredClone(original);
  const next = projectEditPreview(original, form(), [
    { id: "pm2", firstName: "New", lastName: "Manager", email: "pm@example.test" },
    { id: "f2", firstName: "New", lastName: "Foreman", email: "f@example.test" },
  ]);
  assert.equal(next.name, "Updated");
  assert.equal(next.location, "Marikina");
  assert.equal(next.allocatedBudget, 2000000.5);
  assert.equal(next.projectManagerName, "New Manager");
  assert.equal(next.foremanName, "New Foreman");
  assert.equal(next.startDate, "2026-11-01");
  assert.equal(next.targetEndDate, "2026-11-30");
  assert.equal(next.actualEndDate, null);
  assert.deepEqual(next.workingDays, [1,2,3,4,5,6,7]);
  assert.deepEqual(next.holidays, original.holidays);
  assert.equal(next.status, original.status);
  assert.deepEqual(original, before);
});
test("turning all days off preserves an empty selection and blank budget", () => {
  const data = form(); data.delete("workingDays"); data.set("allocatedBudget", "");
  const next = projectEditPreview(original, data, []);
  assert.deepEqual(next.workingDays, []);
  assert.equal(next.allocatedBudget, null);
});
