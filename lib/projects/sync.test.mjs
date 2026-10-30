import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { deriveProjectStatusFromProgress } from "./status.ts";

const code = ts.transpileModule(readFileSync(new URL("./sync.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ allowed = true, status = "completed", date = null, archived = null, work = false, complete = false, readFails = false } = {}) {
  const writes = [];
  const filters = [];
  let privilegedClients = 0;
  const query = {
    select() { return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    is(column, value) { filters.push([column, value]); return query; },
    async maybeSingle() { return { data: { status, actual_end_date: date, archived_at: archived } }; },
    update(values) { writes.push(values); return query; },
  };
  const mocks = {
    "server-only": {},
    "@/lib/supabase/server": { createClient: async () => ({ from: () => query }) },
    "@/lib/supabase/admin": { createAdminClient: () => { privilegedClients++; return { from: () => query }; } },
    "@/lib/auth/project-access": { requireProjectAccess: async () => allowed ? { role: "foreman" } : null },
    "@/lib/cost-estimate/data": { getCostEstimate: async (id, strict) => {
      assert.equal(id, 42);
      assert.equal(strict, true);
      if (readFails) throw new Error("Cannot read progress");
      return { lifecycle: { hasRecordedWork: work, allItemsComplete: complete, itemCount: 1 } };
    } },
    "@/lib/projects/status": { deriveProjectStatusFromProgress },
  };
  const exports = {};
  runInNewContext(code, { exports, console: { error() {} }, require: (name) => {
    assert.ok(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  } });
  return { sync: exports.syncProjectStatusFromProgress, writes, filters, privilegedCount: () => privilegedClients };
}

test("unauthorized callers cannot read or write privileged project state", async () => {
  const fixture = setup({ allowed: false });
  assert.equal(await fixture.sync(42), null);
  assert.equal(fixture.privilegedCount(), 0);
  assert.equal(fixture.filters.length, 0);
});

test("failed progress verification never rewrites project status", async () => {
  const fixture = setup({ readFails: true });
  assert.equal(await fixture.sync(42), null);
  assert.equal(fixture.privilegedCount(), 0);
  assert.equal(fixture.writes.length, 0);
});

test("a stale automatic completion is corrected to Planning", async () => {
  const fixture = setup();
  assert.equal(await fixture.sync(42), "planning");
  assert.equal(fixture.writes[0].status, "planning");
  assert.equal(Object.keys(fixture.writes[0]).length, 1);
});

test("all tasks complete transitions to Completed", async () => {
  const fixture = setup({ status: "ongoing", work: true, complete: true });
  assert.equal(await fixture.sync(42), "completed");
  assert.equal(fixture.writes[0].status, "completed");
});

test("an already Completed project with all tasks complete avoids a redundant write", async () => {
  const fixture = setup({ work: true, complete: true });
  assert.equal(await fixture.sync(42), "completed");
  assert.equal(fixture.privilegedCount(), 0);
});

test("incomplete work reopens a Completed project with a compare-and-set guard", async () => {
  const fixture = setup({ work: true, complete: false });
  assert.equal(await fixture.sync(42), "ongoing");
  assert.equal(fixture.writes[0].status, "ongoing");
  assert.ok(fixture.filters.some(([key, value]) => key === "status" && value === "completed"));
});

test("archived project status is never recalculated or written by the status synchronizer", async () => {
  const fixture = setup({ archived: "2026-10-29T00:00:00Z", readFails: true });
  assert.equal(await fixture.sync(42), "completed");
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.privilegedCount(), 0);
});
