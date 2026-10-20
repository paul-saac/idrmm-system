import test from "node:test";
import assert from "node:assert/strict";
import { readSheetMetadata } from "./model.ts";
function form(overrides = {}) {
  const data = new FormData();
  Object.entries({ sheet_number: " a-01 ", title: "Floor plan", discipline: "Architectural", stage: "original", ...overrides }).forEach(([key, value]) => data.set(key, value));
  return data;
}
test("normalizes identifiers and retains pending approval as missing", () => {
  const data = readSheetMetadata(form());
  assert.equal(data.sheet_number, "A-01");
  assert.equal(data.external_name, null);
  assert.equal(data.document_type, "drawing");
});
test("requires revision notes and validates metadata and approval dates", () => {
  assert.throws(() => readSheetMetadata(form({ stage: "as_built" })));
  assert.throws(() => readSheetMetadata(form({ discipline: "Invalid" })));
  assert.throws(() => readSheetMetadata(form({ approval_date: "2026-02-30" })));
  assert.throws(() => readSheetMetadata(form({ approval_date: "2999-01-01" })));
  assert.throws(() => readSheetMetadata(form({ title: "" })));
  assert.equal(readSheetMetadata(form({ stage: "as_built", change_notes: "Verified: no field changes." })).stage, "as_built");
  assert.equal(readSheetMetadata(form({ document_type: "bom", discipline: "General" })).document_type, "bom");
  assert.throws(() => readSheetMetadata(form({ document_type: "unknown" })));
  assert.throws(() => readSheetMetadata(form({ document_type: "bom", stage: "as_built", change_notes: "No changes" })));
});
