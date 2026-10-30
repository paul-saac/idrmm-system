import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isIncidentDate, validateIncidentFiles, MAX_INCIDENT_FILE_BYTES } from "./model.ts";

const require = createRequire(import.meta.url);
function setup({ authorized = true, contextExists = true, schemaError = null, saveError = null, deleteError = null, incident = null, incidentRows = [] } = {}) {
  const state = { writes: [], deletes: 0, uploads: [], removed: [], tables: [], filters: [] };
  const storage = {
    upload: async (path, bytes) => { state.uploads.push({ path, bytes }); return { error: null }; },
    remove: async paths => { state.removed.push(...paths); return { error: null }; },
    createSignedUrl: async path => ({ data: { signedUrl: `https://example.test/${path}` } }),
  };
  const client = {
    storage: { from: bucket => { assert.equal(bucket, "incident-evidence"); return storage; } },
    from(table) {
      state.tables.push(table);
      assert.ok(["estimate_tasks", "estimate_categories", "project_safety_incidents"].includes(table), "must never access progress entry tables");
      return {
        deleting: false,
        select() { return this; },
        eq(key, value) { state.filters.push([table, key, value]); return this; },
        maybeSingle: async () => ({ data: table === "project_safety_incidents" ? incident : contextExists ? { id: 7 } : null, error: null }),
        limit: async () => ({ data: [], error: schemaError }),
        order: async () => ({ data: incidentRows, error: schemaError }),
        delete() { this.deleting = true; state.deletes += 1; return this; },
        then(resolve) { return resolve({ data: null, error: this.deleting ? deleteError : null }); },
        insert(values) {
          state.writes.push(values);
          return { select: () => ({ single: async () => ({ data: saveError ? null : { id: 42 }, error: saveError }) }) };
        },
      };
    },
  };
  const path = fileURLToPath(new URL("./actions.ts", import.meta.url));
  const source = readFileSync(path, "utf8").replaceAll("console.error(", "__log(");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = new Module(path);
  loadedModule.filename = path;
  loadedModule.require = name => {
    if (name === "@/lib/auth/project-access") return { requireProjectAccess: async () => authorized ? { id: "user-1" } : null };
    if (name === "@/lib/supabase/server") return { createClient: async () => client };
    if (name === "./model") return require("./model.ts");
    return require(name);
  };
  loadedModule._compile(`const __log = () => {};\n${output}`, path);
  return { ...loadedModule.exports, state };
}
function form(overrides = {}) {
  const value = new FormData();
  for (const [key, item] of Object.entries({ incidentType: "equipment_damage", severity: "minor", contextKind: "task", contextId: "7", location: "Site entrance", description: "Mirror damaged. Work paused and supervisor notified.", ...overrides })) value.set(key, item);
  return value;
}
const pdf = () => new File(["%PDF-1.7\nTest evidence"], "evidence.pdf", { type: "application/pdf" });

test("task and category incident submissions save independently of progress", async () => {
  for (const kind of ["task", "category"]) {
    const { reportIncident, state } = setup();
    assert.deepEqual(await reportIncident(12, form({ contextKind: kind })), { id: 42 });
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0][`${kind}_id`], 7);
    assert.equal(state.writes[0].reported_by, "user-1");
    assert.equal(state.writes[0].project_id, 12);
    assert.match(state.writes[0].occurred_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(state.writes[0].occurred_time, /^\d{2}:\d{2}$/);
    assert.equal(state.writes[0].log_date, state.writes[0].occurred_on);
    assert.ok(state.filters.some(([, key, value]) => key === "project_id" && value === 12));
  }
});

test("today's incident list is scoped to the project, work item, and server date", async () => {
  const row = { id: 42, description: "Reported incident" };
  for (const kind of ["task", "category"]) {
    const { listTodayIncidents, state } = setup({ incidentRows: [row] });
    assert.deepEqual((await listTodayIncidents(12, { kind, id: 7 })).items, [{ ...row, attachments: [] }]);
    assert.ok(state.filters.some(([table, key, value]) => table === "project_safety_incidents" && key === "project_id" && value === 12));
    assert.ok(state.filters.some(([table, key, value]) => table === "project_safety_incidents" && key === `${kind}_id` && value === 7));
    const dateFilter = state.filters.find(([table, key]) => table === "project_safety_incidents" && key === "log_date");
    assert.match(dateFilter[2], /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("rejects unauthorized projects and work from another project before uploading", async () => {
  for (const config of [{ authorized: false }, { contextExists: false }]) {
    const { reportIncident, state } = setup(config);
    const data = form(); data.append("attachments", pdf());
    assert.ok((await reportIncident(12, data)).error);
    assert.equal(state.writes.length, 0);
    assert.equal(state.uploads.length, 0);
  }
});

test("validates required fields, enums, dates, times, and lengths", async () => {
  for (const overrides of [{ description: " " }, { description: "x".repeat(5001) }, { incidentType: "__proto__" }, { severity: "unknown" }, { location: "x".repeat(301) }, { contextId: "-1" }]) {
    const { reportIncident, state } = setup();
    assert.ok((await reportIncident(12, form(overrides))).error);
    assert.equal(state.writes.length, 0);
  }
  assert.equal(isIncidentDate("2024-02-29"), true);
  assert.equal(isIncidentDate("2026-02-29"), false);
});

test("limits attachment formats, individual size, combined size, and count", () => {
  const file = { name: "photo.jpg", type: "image/jpeg", size: MAX_INCIDENT_FILE_BYTES };
  assert.equal(validateIncidentFiles([file]), null);
  assert.ok(validateIncidentFiles([{ ...file, size: file.size + 1 }]));
  assert.ok(validateIncidentFiles([{ ...file, type: "text/html" }]));
  assert.ok(validateIncidentFiles([file, file]));
  assert.ok(validateIncidentFiles(Array.from({ length: 6 }, () => ({ ...file, size: 10 }))));
});

test("stores private evidence metadata with the incident", async () => {
  const { reportIncident, state } = setup();
  const data = form(); data.append("attachments", pdf());
  assert.deepEqual(await reportIncident(12, data), { id: 42 });
  assert.match(state.uploads[0].path, /^12\/user-1\/.*\.pdf$/);
  assert.equal(state.writes[0].attachments[0].path, state.uploads[0].path);
  assert.equal(state.writes[0].attachments[0].name, "evidence.pdf");
});

test("cleans up uploaded files after a failed record save", async () => {
  const { reportIncident, state } = setup({ saveError: { code: "42501" } });
  const data = form(); data.append("attachments", pdf());
  assert.ok((await reportIncident(12, data)).error);
  assert.deepEqual(state.removed, state.uploads.map(item => item.path));
});

test("rejects disguised attachments and cleans up preceding uploads", async () => {
  const { reportIncident, state } = setup();
  const data = form(); data.append("attachments", pdf());
  data.append("attachments", new File(["not an image"], "fake.png", { type: "image/png" }));
  assert.ok((await reportIncident(12, data)).error);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.removed, state.uploads.map(item => item.path));
});

test("missing migration gives an actionable error before any evidence upload", async () => {
  const { reportIncident, state } = setup({ schemaError: { code: "PGRST205" } });
  const data = form(); data.append("attachments", pdf());
  assert.match((await reportIncident(12, data)).error, /0096/);
  assert.equal(state.uploads.length, 0);
});

test("loading is project scoped and never signs another project's evidence", async () => {
  const denied = setup({ authorized: false });
  assert.ok((await denied.loadIncident(12, 42)).error);
  assert.equal(denied.state.tables.length, 0);
  const { loadIncident, state } = setup({ incident: { id: 42, attachments: [{ path: "99/other/file.pdf", name: "other.pdf" }, { path: "12/user-1/file.pdf", name: "own.pdf" }] } });
  const result = await loadIncident(12, 42);
  assert.equal(result.evidence[0].url, null);
  assert.ok(result.evidence[1].url);
  assert.ok(state.filters.some(([, key, value]) => key === "project_id" && value === 12));
});

test("incident notification links open the record in its project", async () => {
  const { notificationLink } = await import("../notifications/link.ts");
  assert.equal(notificationLink("/foreman", { kind: "safety_incident", projectId: 12, itemId: 42 }), "/foreman/projects/12?incident=42");
});

test("deleting an incident is project scoped and removes its evidence", async () => {
  const incident = { attachments: [{ path: "12/user-1/evidence.pdf", name: "evidence.pdf" }, { path: "99/other/file.pdf", name: "other.pdf" }] };
  const { deleteIncident, state } = setup({ incident });
  assert.deepEqual(await deleteIncident(12, 42), { success: true });
  assert.equal(state.deletes, 1);
  assert.deepEqual(state.removed, ["12/user-1/evidence.pdf"]);
  assert.ok(state.filters.some(([table, key, value]) => table === "project_safety_incidents" && key === "project_id" && value === 12));
});

test("deleting an incident reports a missing delete policy", async () => {
  const { deleteIncident, state } = setup({ incident: { attachments: [] }, deleteError: { code: "42501" } });
  assert.match((await deleteIncident(12, 42)).error, /0097/);
  assert.equal(state.removed.length, 0);
});
