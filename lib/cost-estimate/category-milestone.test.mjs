import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ error = null, found = true, authorized = true } = {}) {
  const writes = [], filters = [], events = [];
  const query = {
    update(value) { writes.push(value); return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    select(value) { assert.equal(value, "id"); return query; },
    async maybeSingle() { return { data: found && !error ? { id: 9 } : null, error }; },
  };
  const client = { from(table) { assert.equal(table, "estimate_categories"); return query; } };
  const mocks = {
    "@/lib/projects/revalidate": { revalidateProjectPaths: () => events.push("refresh") },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/auth/project-access": { requireProjectAccess: async () => authorized ? { id: "user" } : null },
    "./other-cost-lines": {},
    "@/lib/cost-estimate/undo-redo": { recordGanttCheckpoint: async () => events.push("checkpoint") },
  };
  const exports = {};
  runInNewContext(code, { exports, console: { error() {} }, require: name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  } });
  return { save: exports.updateCategory, writes, filters, events };
}
function form(flag) {
  const value = new FormData();
  value.set("categoryName", "Handover");
  if (flag !== undefined) value.set("milestoneField", "1");
  if (flag) value.set("isMilestone", "on");
  return value;
}

test("standalone milestone can be enabled and disabled, scoped to its project", async () => {
  for (const enabled of [true, false]) {
    const f = setup();
    assert.equal((await f.save(9, 42, {}, form(enabled))).success, true);
    assert.equal(f.writes[0].is_milestone, enabled);
    assert.deepEqual(f.filters, [["id", 9], ["project_id", 42]]);
    assert.deepEqual(f.events, ["checkpoint", "refresh"]);
  }
});

test("renaming a main task preserves a milestone flag that its form does not expose", async () => {
  const f = setup();
  assert.equal((await f.save(9, 42, {}, form())).success, true);
  assert.equal(Object.hasOwn(f.writes[0], "is_milestone"), false);
});

test("missing milestone column or stale schema cache identifies the repair migration", async () => {
  for (const code of ["42703", "PGRST204"]) {
    const f = setup({ error: { code, message: "Missing is_milestone column", details: "", hint: "" } });
    assert.match((await f.save(9, 42, {}, form(true))).error, /0102_repair_standalone_category_milestones/);
    assert.deepEqual(f.events, []);
  }
});

test("permission failures and unmatched updates cannot report a successful save", async () => {
  const denied = setup({ authorized: false });
  assert.match((await denied.save(9, 42, {}, form(true))).error, /not authorized/);
  assert.deepEqual(denied.writes, []);
  const permission = setup({ error: { code: "42501", message: "denied", details: "", hint: "" } });
  assert.match((await permission.save(9, 42, {}, form(true))).error, /permission/);
  const missing = setup({ found: false });
  assert.match((await missing.save(9, 42, {}, form(true))).error, /not found/);
  assert.deepEqual(missing.events, []);
});

const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require("@electric-sql/pglite")); } catch { /* Optional local SQL verification. */ }
test("repair migration adds milestone storage without losing records and is safe to rerun", { skip: !PGlite }, async () => {
  const db = new PGlite();
  try {
    await db.exec("create table estimate_categories(id bigint primary key, category_name text, category_labor_estimate numeric); insert into estimate_categories values(1,'Handover',1200)");
    const migration = readFileSync(new URL("../../supabase/migrations/0102_repair_standalone_category_milestones.sql", import.meta.url), "utf8");
    await db.exec(migration);
    assert.deepEqual((await db.query("select category_name,category_labor_estimate::int as cost,is_milestone from estimate_categories")).rows,
      [{ category_name: "Handover", cost: 1200, is_milestone: false }]);
    await db.exec("update estimate_categories set is_milestone=true where id=1");
    await db.exec(migration);
    assert.equal((await db.query("select is_milestone from estimate_categories where id=1")).rows[0].is_milestone, true);
  } finally { await db.close(); }
});
