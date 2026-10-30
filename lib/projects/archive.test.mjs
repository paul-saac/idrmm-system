import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function compile(path, mocks) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, console, require(name) {
    assert.ok(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  } });
  return exports;
}
function actions({ role = "admin", completion = "completed", rpcError = null } = {}) {
  const calls = [], refreshes = [];
  const api = compile("./actions.ts", {
    "@/lib/projects/revalidate": Object.fromEntries(["revalidateProjectLists", "revalidateProjectPaths", "revalidateInventory", "revalidateReports"].map(name => [name, (...args) => refreshes.push([name, ...args])])),
    "next/cache": { revalidatePath: path => refreshes.push(path) },
    "@/lib/projects/sync": { syncProjectStatusFromProgress: async id => { calls.push(["sync", id]); return completion; } },
    "@/lib/supabase/server": { createClient: async () => ({ rpc: async (name, args) => { calls.push([name, args]); return { error: rpcError }; } }) },
    "@/lib/auth/session": { getSessionProfile: async () => role ? { id: "actor", role } : null },
    "@/lib/auth/project-access": {},
    "@/lib/auth/roles": { isAdminRole: value => ["admin", "super_admin"].includes(value) },
  });
  return { ...api, calls, refreshes };
}

test("archive actions reject non-administrators before reading or changing project data", async () => {
  for (const role of [null, "project_manager", "foreman"]) {
    const f = actions({ role });
    assert.match((await f.setProjectArchived(1, true, {}, new FormData())).error, /Only administrators/);
    assert.equal(f.calls.length, 0);
  }
});

test("archive checks actual completion and sends only archive metadata to the protected RPC", async () => {
  for (const role of ["admin", "super_admin"]) {
    const f = actions({ role });
    const form = new FormData();
    form.set("reason", "  Handover complete  ");
    assert.equal((await f.setProjectArchived(1, true, {}, form)).success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
      ["sync", 1], ["set_project_archived", { p_project_id: 1, p_archived: true, p_reason: "Handover complete" }],
    ]);
    assert.ok(f.refreshes.includes("/admin"));
  }
  for (const completion of [null, "planning", "ongoing"]) {
    const f = actions({ completion });
    assert.match((await f.setProjectArchived(1, true, {}, new FormData())).error, /Only completed/);
    assert.equal(f.calls.length, 1);
  }
});

test("unarchive retains the stored status and returns useful validation/database errors", async () => {
  const f = actions();
  assert.equal((await f.setProjectArchived(1, false, {}, new FormData())).success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [["set_project_archived", { p_project_id: 1, p_archived: false, p_reason: null }]]);
  for (const [rpcError, expected] of [
    [{ code: "PGRST202", message: "Missing" }, /0104/],
    [{ code: "P0001", message: "Return all assigned equipment" }, /Return all/],
    [{ code: "42501", message: "Only administrators" }, /Only administrators/],
    [{ code: "40001", message: "Archive state changed" }, /state changed/],
  ]) {
    const fixture = actions({ rpcError });
    assert.match((await fixture.setProjectArchived(1, false, {}, new FormData())).error, expected);
    assert.equal(fixture.refreshes.length, 0);
  }
  for (const invalidId of [-1, 0, NaN, 1.5]) {
    assert.match((await f.setProjectArchived(invalidId, true, {}, new FormData())).error, /valid project/);
  }
});

test("administrators cannot bypass view-only archive access in server actions", async () => {
  for (const role of ["admin", "super_admin", "project_manager", "foreman"]) {
    const profile = { id: "actor", role };
    const api = compile("../auth/project-access.ts", {
      "@/lib/auth/session": { getSessionProfile: async () => profile },
      "@/lib/auth/roles": { isAdminRole: value => ["admin", "super_admin"].includes(value) },
      "@/lib/supabase/server": { createClient: async () => ({ rpc: async () => ({ data: "view" }) }) },
    });
    assert.equal(await api.requireProjectAccess(1), null);
    assert.equal(await api.requireProjectAccess(1, "view"), profile);
  }
});

test("operational project lists exclude archives; history/report lists retain their stored status without syncing", async () => {
  const rows = [
    { id: 1, project_name: "Current", status: "planning", archived_at: null },
    { id: 2, project_name: "History", status: "completed", archived_at: "2026-10-29T00:00:00Z", archived_by: "actor", archive_reason: "Handover" },
  ];
  for (const includeArchived of [false, true]) {
    const readProgress = [], synced = [];
    const api = compile("./data.ts", {
      "@/lib/supabase/server": { createClient: async () => ({ from: table => {
        const query = { select: () => query, order: async () => ({ data: rows }), in: async () => ({ data: [] }) };
        assert.ok(["projects", "profiles"].includes(table));
        return query;
      } }) },
      "@/lib/cost-estimate/data": { getCostEstimate: async id => { readProgress.push(id); return { lifecycle: {} }; } },
      "./status": { deriveProjectStatusFromProgress: () => "ongoing" },
      "./sync": { syncProjectStatusFromProgress: async id => synced.push(id) },
    });
    const projects = await api.listProjects({ includeArchived });
    assert.deepEqual(Array.from(projects, p => p.id), includeArchived ? [1, 2] : [1]);
    assert.deepEqual(readProgress, [1]);
    assert.deepEqual(synced, [1]);
    if (includeArchived) {
      assert.equal(projects[1].status, "completed");
      assert.equal(projects[1].archiveReason, "Handover");
    }
  }
});
