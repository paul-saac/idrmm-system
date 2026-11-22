import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire,Module} from "node:module";
import ts from "typescript";
import {sheetRecordStatus} from "./model.ts";
const require=createRequire(import.meta.url);
function actions(role, existing=[]){
 const writes=[],uploads=[],deletions=[],removedFiles=[];
 const client={from:table=>{
   const filters=[];let deleting=false;
   const query={
     insert:async row=>{writes.push(row);return {error:null};},
     select(){return query;}, delete(){deleting=true;return query;},
     eq(key,value){filters.push(row=>row[key]===value);return query;},
     in(key,values){filters.push(row=>values.includes(row[key]));return query;},
     async maybeSingle(){return {data:existing.find(row=>filters.every(f=>f(row)))??null,error:null};},
     then(resolve,reject){const data=table==="project_sheets"?existing.filter(row=>filters.every(f=>f(row))):[];if(deleting)deletions.push({table,ids:data.map(row=>row.id)});return Promise.resolve({data,error:null}).then(resolve,reject);}
   };return query;
 },storage:{from:()=>({upload:async path=>{uploads.push(path);return {error:null};},remove:async paths=>{removedFiles.push(...paths);return {error:null};}})}};
 const loaded=new Module(import.meta.filename);loaded.filename=import.meta.filename;
 loaded.require=name=>name==="@/lib/supabase/server"?{createClient:async()=>client}:name==="@/lib/supabase/admin"?{createAdminClient:()=>client}:name==="@/lib/auth/project-access"?{requireProjectAccess:async()=>({id:"account",role,firstName:"Test",lastName:"Owner"})}:name==="@/lib/auth/roles"?{isAdminRole:r=>["admin","super_admin"].includes(r)}:name==="./model"?require("./model.ts"):name==="@/lib/projects/revalidate"?{revalidateProjectPaths(){},revalidateReports(){}}:require(name);
 loaded._compile(ts.transpileModule(readFileSync(new URL("./actions.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,import.meta.filename);
 return {...loaded.exports,writes,uploads,deletions,removedFiles};
}
function form(){const f=new FormData();for(const [key,value]of Object.entries({sheet_number:"A-01",title:"Official plan",discipline:"Architectural",stage:"original",document_type:"drawing"}))f.set(key,value);f.set("drawing",new File(["%PDF-test"],"plan.pdf",{type:"application/pdf"}));return f;}
test("PM and Foreman cannot publish or upload even with project edit access",async()=>{for(const role of ["project_manager","foreman"]){const a=actions(role);assert.match((await a.submitSheet(1,form())).error,/Owner/);assert.equal(a.uploads.length,0);assert.equal(a.writes.length,0);}});
test("Admin and Super Admin publish immediately without inventing external verification",async()=>{for(const role of ["admin","super_admin"]){const a=actions(role);assert.equal((await a.submitSheet(1,form())).success,true);assert.equal(a.writes[0].status,"published");assert.equal(a.writes[0].external_name,null);assert.equal(a.writes[0].approval_date,null);assert.equal(a.writes[0].evidence_path,null);assert.equal(a.reviewSheet,undefined);}});
test("new revisions supersede older versions without changing legacy review decisions",()=>{assert.equal(sheetRecordStatus({status:"published",revision:2},2),"Current");assert.equal(sheetRecordStatus({status:"published",revision:1},2),"Superseded");assert.equal(sheetRecordStatus({status:"rejected",revision:2},2),"Rejected");});

const versions=[
 {id:10,project_id:1,sheet_number:"A-01",file_path:"original.pdf",evidence_path:null},
 {id:11,project_id:1,sheet_number:"A-01",file_path:"revision.pdf",evidence_path:"revision.pdf"},
 {id:12,project_id:1,sheet_number:"B-01",file_path:"other.pdf",evidence_path:null},
 {id:13,project_id:2,sheet_number:"A-01",file_path:"another-project.pdf",evidence_path:null},
];
test("individual version deletion preserves other versions and other projects",async()=>{
 for(const role of ["admin","super_admin"]){
  const a=actions(role,versions);assert.equal((await a.deleteSheet(1,11,"version")).error,null);
  assert.deepEqual(a.deletions.find(d=>d.table==="project_sheets").ids,[11]);
  assert.deepEqual(a.removedFiles,["revision.pdf"]);
 }
});
test("whole document deletion retains its existing all-versions behavior",async()=>{
 const a=actions("admin",versions);assert.equal((await a.deleteSheet(1,11)).error,null);
 assert.deepEqual(a.deletions.find(d=>d.table==="project_sheets").ids,[10,11]);
 assert.deepEqual(a.removedFiles,["original.pdf","revision.pdf"]);
});
test("PM and Foreman cannot delete a version or whole document",async()=>{
 for(const role of ["project_manager","foreman"]){for(const scope of ["version","document"]){
 const a=actions(role,versions);assert.match((await a.deleteSheet(1,11,scope)).error,/Only administrators/);assert.equal(a.deletions.length,0);assert.equal(a.removedFiles.length,0);
 }}
});
test("deletion rejects cross-project IDs and invalid scopes",async()=>{
 const a=actions("admin",versions);
 assert.match((await a.deleteSheet(1,13,"version")).error,/not found/);
 assert.match((await a.deleteSheet(1,11,"everything")).error,/valid deletion/);
 assert.equal(a.deletions.length,0);
});
