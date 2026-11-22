import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";
const require=createRequire(import.meta.url);
const model=require("./model.ts");
const nodes=value=>!value||typeof value!=="object"?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null?"":typeof value==="string"?value:Array.isArray(value)?value.map(text).join(""):text(value.props?.children);
function fixture(portal,incident,closeResult={incident}) {
 const state=new Map();let key="root",cursor=0,submissions=0,updates=0;
 const react={useEffect(){},useState(initial){const values=state.get(key)??[];state.set(key,values);const i=cursor++;if(!(i in values))values[i]=typeof initial==="function"?initial():initial;return[values[i],value=>{values[i]=typeof value==="function"?value(values[i]):value;}];}};
 const jsx=(type,props)=>({type,props});const exports={};
 class Form extends FormData {constructor(initial){super();if(initial)for(const[k,v]of initial.entries())this.append(k,v);}}
 const source=readFileSync("components/projects/progress/incident-detail-modal.tsx","utf8");
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports,Date,FormData:Form,require(name){
  if(name==="react")return react;if(name==="react/jsx-runtime")return{jsx,jsxs:jsx};
  if(name==="@/components/portal/portal-context")return{usePortal:()=>portal};
  if(name==="@/lib/incidents/model")return model;
  if(name==="@/lib/incidents/report")return{incidentReportSections:()=>[],incidentReportedDate:value=>value};
  if(name==="@/lib/incidents/actions")return{closeIncident:async()=>{submissions++;return closeResult;},loadIncident:async()=>({error:"Preview unavailable"})};
  return{};
 }});
 function renderComponent(component,props,scope){key=scope;cursor=0;return component(props);}
 const render=()=>renderComponent(exports.IncidentDetailModal,{projectId:12,id:42,projectName:"La Colina",result:{incident,evidence:[]},onClose(){},onUpdated(){updates++;}},"root");
 const content=()=>{const root=render();const child=nodes(root).find(node=>["IncidentDetails","IncidentCloseoutForm"].includes(node.type?.name));return renderComponent(child.type,child.props,child.type.name);};
 return{render,content,get submissions(){return submissions;},get updates(){return updates;}};
}
const incident={id:42,project_id:12,occurred_on:"2026-11-22",created_at:"2026-11-22T12:00:00Z",reporter_name:"Foreman",attachments:[]};
test("closeout button is available to PM/Admin but hidden from Foremen and closed records",()=>{
 for(const portal of [{isAdmin:true,basePath:"/admin"},{isAdmin:false,basePath:"/project-manager"}])assert.match(text(fixture(portal,incident).content()),/Close incident/);
 assert.ok(!text(fixture({isAdmin:false,basePath:"/foreman"},incident).content()).includes("Close incident"));
 assert.ok(!text(fixture({isAdmin:true,basePath:"/admin"},{...incident,closeout:{attachments:[]}}).content()).includes("Close incident"));
});
test("close incident opens a form in the same modal and cancel returns to details",()=>{
 const f=fixture({isAdmin:true,basePath:"/admin"},incident);
 nodes(f.content()).find(node=>text(node)==="Close incident"&&node.props.onClick).props.onClick();
 assert.equal(f.render().props.title,"Close incident");const form=f.content();assert.equal(form.type,"form");
 const submit=nodes(form).find(node=>node.type==="button"&&node.props.type==="submit");
 assert.equal(submit.props.form,form.props.id,"footer is portaled outside the form, so submit must explicitly target its ID");
 for(const name of ["findings","actionTaken"])assert.equal(nodes(form).find(node=>node.props?.name===name).props.required,true);
 assert.ok(nodes(form).find(node=>node.props?.name==="attachments"));
 nodes(form).find(node=>node.type==="button"&&text(node)==="Cancel").props.onClick();assert.equal(f.render().props.title,"Nov 22, 2026");
});
test("committed closeout immediately updates incident status without adding another incident",async()=>{
 const closed={...incident,closeout:{findings:"Cause",actionTaken:"Corrected",attachments:[],closedByName:"PM",closedAt:"2026-11-23T00:00:00Z"}};
 const f=fixture({isAdmin:true,basePath:"/admin"},incident,{incident:closed});
 nodes(f.content()).find(node=>text(node)==="Close incident"&&node.props.onClick).props.onClick();
 const data=new FormData();data.set("findings","Cause");data.set("actionTaken","Corrected");
 await f.content().props.onSubmit({preventDefault(){},currentTarget:data});
 assert.equal(f.submissions,1);assert.equal(f.updates,1);assert.match(text(f.content()),/Closed/);assert.ok(!text(f.content()).includes("Close incident"));
});
test("SQL closure keeps authorization, session, maintenance, row-lock and evidence protections",()=>{
 const sql=readFileSync("supabase/migrations/0151_incident_closeout.sql","utf8");
 for(const guard of ["public.app_session_is_active()","public.system_backup_maintenance()","public.project_access_level(p_project_id)","public.can_access_safety_incidents(p_project_id)","FOR UPDATE","v_incident.closeout IS NOT NULL","REVOKE UPDATE","guard_incident_closeout_insert","Keep attached incident closeout evidence"] )assert.ok(sql.includes(guard),guard);
 assert.match(sql,/NOT IN \('project_manager','admin','super_admin'\)/);
 assert.ok(sql.includes("'closedBy',auth.uid()"));assert.ok(sql.includes("'closedAt',now()"));
});
