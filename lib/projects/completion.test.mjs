import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { deriveProjectStatusFromProgress } from "./status.ts";
import { isAdminRole } from "../auth/roles.ts";

const code = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ role = "admin", complete = true, work = true, readFails = false } = {}) {
  const writes = [];
  const query = {
    select() { return query; },
    eq() { return query; },
    async single() { return { data: { project_manager_id: "pm", foreman_id: "foreman" } }; },
    update(values) { writes.push(values); return query; },
  };
  const mocks = {
    "@/lib/projects/revalidate": { revalidateProjectLists() {}, revalidateProjectPaths() {} },
    "next/navigation": {},
    "@/lib/supabase/server": { createClient: async () => ({ from: () => query }) },
    "@/lib/auth/session": { getSessionProfile: async () => role ? { role } : null },
    "@/lib/auth/project-access": {},
    "@/lib/daily-logs/actions": {},
    "@/lib/auth/roles": { isAdminRole },
    "@/lib/cost-estimate/data": { getCostEstimate: async (_id, strict) => {
      assert.equal(strict, true);
      if (readFails) throw new Error("Read failed");
      return { lifecycle: { hasRecordedWork: work, allItemsComplete: complete, itemCount: 1 } };
    } },
    "./status": { deriveProjectStatusFromProgress },
  };
  const exports = {};
  runInNewContext(code, { exports, console, require: (name) => {
    assert.ok(name in mocks, `Unexpected import ${name}`);
    return mocks[name];
  } });
  return { update: exports.updateProject, writes };
}

function form(confirmed = true, end = "2020-01-02") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ projectName: "Test", projectManagerId: "pm", foremanId: "foreman", startDate: "2020-01-01", targetEndDate: "2099-01-01", actualEndDate: end })) data.set(key, value);
  if (confirmed) data.set("confirmCompletion", "on");
  return data;
}

test("admin may confirm early completion with an actual end date", async () => {
  const { update, writes } = setup();
  assert.equal((await update(42, {}, form())).success, true);
  assert.equal(writes[0].status, "completed");
  assert.equal(writes[0].actual_end_date, "2020-01-02");
});

test("super admin may confirm completion", async () => {
  const { update, writes } = setup({ role: "super_admin" });
  assert.equal((await update(42, {}, form())).success, true);
  assert.equal(writes[0].status, "completed");
});

for (const role of [null, "foreman", "project_manager"]) test(`${role} cannot confirm completion`, async () => {
  const { update, writes } = setup({ role });
  assert.ok((await update(42, {}, form())).error);
  assert.equal(writes.length, 0);
});

for (const options of [{ complete: false }, { readFails: true }]) test(`completion is blocked: ${JSON.stringify(options)}`, async () => {
  const { update, writes } = setup(options);
  assert.ok((await update(42, {}, form())).error);
  assert.equal(writes.length, 0);
});

for (const end of ["", "2099-01-01", "2019-12-31", "2020-02-31"]) test(`invalid actual end date is rejected: ${end}`, async () => {
  const { update, writes } = setup();
  assert.ok((await update(42, {}, form(true, end))).error);
  assert.equal(writes.length, 0);
});

test("an unconfirmed fully logged project stays Ongoing", async () => {
  const { update, writes } = setup();
  assert.equal((await update(42, {}, form(false))).success, true);
  assert.equal(writes[0].status, "ongoing");
  assert.equal(writes[0].actual_end_date, null);
});
