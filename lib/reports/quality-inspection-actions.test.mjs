import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const baseMigration = readFileSync(new URL("../../supabase/migrations/0093_project_quality_inspections.sql", import.meta.url), "utf8");
const scopeMigration = readFileSync(new URL("../../supabase/migrations/0094_quality_inspection_certificate_fields.sql", import.meta.url), "utf8");
const baseColumns = [...baseMigration.matchAll(/^\s+(\w+)\s+(?:text|date|bigint|uuid|timestamptz)\b/gm)].map(match => match[1]);
const scopeColumns = [...scopeMigration.matchAll(/add column if not exists (\w+)/g)].map(match => match[1]);

function setup({ withScope = true, error = null, existing = null } = {}) {
  const columns = new Set([...baseColumns, ...(withScope ? scopeColumns : [])]);
  const state = { saved: null, filters: [], revalidated: false, logged: [] };
  const write = values => {
    const missing = Object.keys(values).find(key => !columns.has(key));
    const failure = error ?? (missing ? {
      code: "PGRST204",
      message: `Could not find the '${missing}' column of 'project_quality_inspections' in the schema cache`,
    } : null);
    if (!failure) state.saved = { ...existing, ...values };
    return { error: failure };
  };
  const client = {
    from(table) {
      assert.equal(table, "project_quality_inspections");
      return {
        insert: async values => write(values),
        update(values) {
          return {
            eq(column, value) { state.filters.push([column, value]); return this; },
            then(resolve, reject) { return Promise.resolve(write(values)).then(resolve, reject); },
          };
        },
      };
    },
  };
  const path = fileURLToPath(new URL("./quality-inspection-actions.ts", import.meta.url));
  const source = readFileSync(path, "utf8").replace("console.error(", "__log(");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = new Module(path);
  loaded.filename = path;
  loaded.require = name => {
    if (name === "@/lib/auth/project-access") return { requireProjectAccess: async () => ({ id: "test-user" }) };
    if (name === "@/lib/supabase/server") return { createClient: async () => client };
    if (name === "@/lib/projects/revalidate") return {
      revalidateReports: () => { state.revalidated = true; },
      revalidateProjectPaths: () => {},
    };
    if (name === "./quality-inspection-model") return require("./quality-inspection-model.ts");
    return require(name);
  };
  loaded.exports.__log = error => state.logged.push(error);
  loaded._compile(`const __log = exports.__log;\n${output}`, path);
  return { save: loaded.exports.saveQualityInspection, state };
}

function form(inspectionId = "") {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    inspectionId, inspectionType: "structural", inspectionScope: "Concrete footings",
    area: "Grid A1", inspectedOn: "2026-10-23", inspectorName: "Test inspector",
    result: "passed", testName: "Concrete strength", actualResult: "31.5", resultUnit: "MPa",
  })) data.set(key, value);
  return data;
}

test("saves the simplified inspection with migrations 0093 and 0094, without 0095", async () => {
  const { save, state } = setup();
  assert.deepEqual(await save(12, form()), { success: true });
  assert.equal(state.saved.inspection_scope, "Concrete footings");
  assert.equal(state.saved.actual_result, "31.5");
  assert.equal(state.saved.project_id, 12);
  assert.equal(state.saved.recorded_by, "test-user");
  assert.equal(state.revalidated, true);
});

test("editing preserves stored details that are no longer exposed by the form", async () => {
  const hidden = {
    authority_type: "testing_laboratory", certificate_number: "CERT-1", issued_on: "2026-10-20",
    standard_reference: "Recorded standard", nonconformance_description: "Recorded finding",
    corrective_action_required: "Recorded action", punch_item_id: 4, reinspection_reference: "INS-2",
    related_work_key: "task-1", related_work_name: "Footings", inspector_role: "Engineer", license_number: "LIC-1",
  };
  const { save, state } = setup({ existing: hidden });
  assert.deepEqual(await save(12, form("7")), { success: true });
  for (const [key, value] of Object.entries(hidden)) assert.equal(state.saved[key], value);
  assert.deepEqual(state.filters, [["id", 7], ["project_id", 12]]);
});

test("0093-only schema identifies the missing Work inspected migration", async () => {
  const { save, state } = setup({ withScope: false });
  const result = await save(12, form());
  assert.match(result.error, /0094_quality_inspection_certificate_fields\.sql/);
  assert.doesNotMatch(result.error, /0093/);
  assert.equal(state.saved, null);
  assert.equal(state.revalidated, false);
});

test("database failures distinguish a missing table, permissions, and other errors", async () => {
  for (const [code, message, expected] of [
    ["42P01", "missing table", /migration 0093/],
    ["PGRST205", "missing table in cache", /migration 0093/],
    ["42703", 'column "inspection_scope" does not exist', /migration 0094/],
    ["42501", "row-level security policy", /permission/],
    ["23514", "private database details", /23514/],
  ]) {
    const { save, state } = setup({ error: { code, message } });
    const result = await save(12, form());
    assert.match(result.error, expected);
    assert.doesNotMatch(result.error, /private database details/);
    assert.equal(state.saved, null);
    assert.equal(state.revalidated, false);
  }
});
