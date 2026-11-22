import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isIncidentDate, validateIncidentFiles, MAX_INCIDENT_FILE_BYTES } from "./model.ts";

const require = createRequire(import.meta.url);
function setup({ authorized = true, contextExists = true, schemaError = null, saveError = null, deleteError = null, incident = null, incidentRows = [], role = "foreman", rpcError = null } = {}) {
  const state = { afterResponse: [], writes: [], deletes: 0, uploads: [], removed: [], tables: [], filters: [], rpcs: [] };
  const storage = {
    upload: async (path, bytes) => { state.uploads.push({ path, bytes }); return { error: null }; },
    remove: async paths => { state.removed.push(...paths); return { error: null }; },
    createSignedUrl: async path => ({ data: { signedUrl: `https://example.test/${path}` } }),
  };
  const client = {
    rpc: async (name, args) => {state.rpcs.push({name,args}); return {data: rpcError ? null : {...incident, closeout:{findings:args.p_findings,actionTaken:args.p_action_taken,attachments:args.p_attachments,closedBy:"user-1",closedByName:"Project Manager",closedAt:"2026-11-23T00:00:00Z"}},error:rpcError};},
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
    if (name === "next/server") return { after: callback => state.afterResponse.push(callback) };
    if (name === "@/lib/auth/project-access") return { requireProjectAccess: async () => authorized ? { id: "user-1", role } : null };
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
  assert.deepEqual(state.removed, [], "response does not wait for evidence cleanup");
  assert.equal(state.afterResponse.length, 1);
  await state.afterResponse[0]();
  assert.deepEqual(state.removed, ["12/user-1/evidence.pdf"]);
  assert.ok(state.filters.some(([table, key, value]) => table === "project_safety_incidents" && key === "project_id" && value === 12));
});

test("deleting an incident reports a missing delete policy", async () => {
  const { deleteIncident, state } = setup({ incident: { attachments: [] }, deleteError: { code: "42501" } });
  assert.match((await deleteIncident(12, 42)).error, /0097/);
  assert.equal(state.removed.length, 0);
});


const details = {people:[{name:"Worker One",role:"Carpenter",contact:"09123456789"}],kinds:["fall_slip","injury"],otherType:"",injured:true,injuryDescription:"Scraped knee",firstAid:true,hospitalTransport:false,medicalProvider:"Site first aider"};
test("structured reports preserve people, multiple incident types and medical details with the actual occurrence date",async()=>{
 const {reportIncident,state}=setup();const data=form({occurredOn:"2026-01-02",occurredTime:"14:30",details:JSON.stringify(details)});
 assert.deepEqual(await reportIncident(12,data),{id:42});
 assert.deepEqual(state.writes[0].details,details);assert.equal(state.writes[0].occurred_on,"2026-01-02");assert.equal(state.writes[0].occurred_time,"14:30");assert.equal(state.writes[0].incident_type,"injury");
});
test("invalid structured fields and future occurrence dates never write or upload",async()=>{
 for(const overrides of [{occurredOn:"9999-01-01"},{occurredOn:"2026-02-30"},{occurredTime:"25:10"},{details:"{"},{details:JSON.stringify({...details,kinds:[]})},{details:JSON.stringify({...details,people:[{name:"",role:"Worker",contact:""}]})},{details:JSON.stringify({...details,injuryDescription:""})},{details:JSON.stringify({...details,firstAid:"yes"})}]){
  const {reportIncident,state}=setup();const data=form(overrides);data.append("attachments",pdf());assert.ok((await reportIncident(12,data)).error);assert.equal(state.writes.length,0);assert.equal(state.uploads.length,0);
 }
});
test("task incident list includes all dates while remaining scoped to its project and task",async()=>{
 const {listTaskIncidents,state}=setup({incidentRows:[{id:42,occurred_on:"2026-01-02"},{id:43,occurred_on:"2026-01-03"}]});
 const result=await listTaskIncidents(12,{kind:"task",id:7});assert.equal(result.items.length,2);
 assert.ok(state.filters.some(([,key,value])=>key==="project_id"&&value===12));assert.ok(state.filters.some(([,key,value])=>key==="task_id"&&value===7));assert.ok(!state.filters.some(([,key])=>key==="log_date"));
});

test("offline replay returns its existing report without writing or uploading again", async () => {
 const {reportIncident,state}=setup({incident:{id:77,attachments:[]}});
 const input=form({offlineSubmissionId:"12345678-1234-1234-1234-123456789012"});
 assert.deepEqual(await reportIncident(12,input),{id:77});assert.equal(state.writes.length,0);assert.equal(state.uploads.length,0);
 assert.ok(state.filters.some(filter=>filter.includes("offline_submission_id")));
});
test("invalid offline identifiers never create incident records", async () => {
 const {reportIncident,state}=setup();assert.match((await reportIncident(12,form({offlineSubmissionId:"invalid"}))).error,/identity/);assert.equal(state.writes.length,0);
});


function closeoutForm() { const f=new FormData();f.set("findings","Materials obstructed the walkway.");f.set("actionTaken","Cleared the walkway and briefed the crew.");return f; }
test("Project Manager, Admin and Super Admin can close incidents without modifying progress", async()=>{
 for(const role of ["project_manager","admin","super_admin"]){const a=setup({role,incident:{id:42,closeout:null}});
 const result=await a.closeIncident(12,42,closeoutForm());assert.equal(result.incident.closeout.closedBy,"user-1");assert.equal(a.state.rpcs[0].name,"close_safety_incident");assert.equal(a.state.rpcs[0].args.p_project_id,12);assert.equal(a.state.writes.length,0);}
});
test("Foremen and unauthorized projects cannot close incidents",async()=>{
 for(const config of [{role:"foreman"},{role:"project_manager",authorized:false}]){const a=setup(config);const f=closeoutForm();f.append("attachments",pdf());assert.ok((await a.closeIncident(12,42,f)).error);assert.equal(a.state.rpcs.length,0);assert.equal(a.state.uploads.length,0);}
});
test("closeout requires findings and action taken and rejects closed or missing incidents",async()=>{
 for(const key of ["findings","actionTaken"]){const a=setup({role:"project_manager",incident:{id:42,closeout:null}});const f=closeoutForm();f.set(key," ");assert.ok((await a.closeIncident(12,42,f)).error);assert.equal(a.state.rpcs.length,0);}
 for(const incident of [null,{id:42,closeout:{}}]){const a=setup({role:"admin",incident});assert.ok((await a.closeIncident(12,42,closeoutForm())).error);assert.equal(a.state.rpcs.length,0);}
});
test("closeout validates files, cleans failed uploads and rejects concurrent duplicate closure",async()=>{
 const a=setup({role:"project_manager",incident:{id:42,closeout:null},rpcError:{code:"P0001",message:"This incident has already been closed"}});
 const f=closeoutForm();f.append("attachments",pdf());assert.match((await a.closeIncident(12,42,f)).error,/already been closed/);assert.equal(a.state.uploads.length,1);assert.equal(a.state.removed.length,1);
 const bad=setup({role:"admin",incident:{id:42,closeout:null}});const forged=closeoutForm();forged.append("attachments",new File(["not a pdf"],"fake.pdf",{type:"application/pdf"}));assert.match((await bad.closeIncident(12,42,forged)).error,/not a valid/);assert.equal(bad.state.uploads.length,0);
});
test("incident deletion cleans original and closeout attachments",async()=>{
 const a=setup({incident:{attachments:[{path:"12/u1/original.pdf"}],closeout:{attachments:[{path:"12/u2/closure.pdf"}]}}});
 assert.equal((await a.deleteIncident(12,42)).success,true);for(const cleanup of a.state.afterResponse)await cleanup();assert.deepEqual(a.state.removed,["12/u1/original.pdf","12/u2/closure.pdf"]);
});
