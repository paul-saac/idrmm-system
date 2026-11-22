import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const model=require('./model.ts');
function load(name){
 const exports={};const code=ts.transpileModule(readFileSync(`lib/incidents/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,Date,Intl,console,require(name){if(name==='./model')return model;if(name==='./report')return load('report');return require(name);}});return exports;
}
const incident={id:42,project_id:12,task_id:7,category_id:null,context_name:'Site Clearing',incident_type:'other',severity:'minor',occurred_on:'2026-11-22',occurred_time:'21:42:00',created_at:'2026-11-22T14:10:38Z',reporter_name:'Trisha Bravo',location:'Site entrance',description:'Scaffold panel fell.',attachments:[],details:{people:[{name:'Alex',role:'Foreman',contact:'09123456789'}],kinds:['other'],otherType:'Scaffold collapse',injured:true,injuryDescription:'Bruised arm',firstAid:true,hospitalTransport:false,medicalProvider:'Site first aider'}};
test('report sections preserve custom types, people, occurrence time and medical answers',()=>{
 const report=load('report');const groups=report.incidentReportSections(incident);
 assert.equal(model.incidentTitle(incident),'Scaffold collapse');
 assert.equal(groups[0].rows[0][1],'Scaffold collapse');assert.equal(groups[0].rows.find(row=>row[0]==='Time occurred')[1],'9:42 PM');
 assert.equal(groups[1].rows[0][0],'Alex');assert.equal(groups[2].rows[1][1],'Bruised arm');
 assert.match(report.incidentReportedDate(incident.created_at),/11\/22\/2026, 10:10:38 PM/);
 assert.throws(()=>model.parseIncidentDetails(JSON.stringify({...incident.details,otherType:' '})),/Describe the other/);
 assert.equal(model.incidentTitle({...incident,details:undefined,incident_type:'injury'}),'Injury');
});
test('incident PDF renders complete report and safely paginates long descriptions',async()=>{
 const {createIncidentPdf}=load('report-pdf');
 const pdf=await createIncidentPdf(incident,'La Colina');assert.ok(pdf.output('arraybuffer').byteLength>1000);
 const text=pdf.internal.pages.flat().join('\n');for(const expected of ['INCIDENT REPORT','Organisation:','IDR M&M Construction','Address:','D. Mariano St., Concepcion Uno, Marikina City','Contact Number:','+63 967 217 3481','Prepared By:','Project:','Form created:','Trisha Bravo','Scaffold collapse','Bruised arm','No attachments.'])assert.ok(text.includes(expected),expected);
 const long=await createIncidentPdf({...incident,description:'Detailed observation of the incident and its circumstances. '.repeat(1000)},'La Colina');
 assert.ok(long.getNumberOfPages()>2);assert.ok(long.output('arraybuffer').byteLength>1000);
 for(const page of long.internal.pages.slice(1)){const text=page.join('\n');for(const label of ['Organisation:','Prepared By:','Project:','Form created:'])assert.ok(text.includes(label),`every page includes ${label}`);}
});
test('incident detail puts reporter and reported date in its header and offers a PDF download',()=>{
 const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
 const text=value=>value==null?'':typeof value==='string'?value:Array.isArray(value)?value.map(text).join(''):text(value.props?.children);
 const jsx=(type,props)=>({type,props});const exports={};
 const code=ts.transpileModule(readFileSync('components/projects/progress/incident-detail-modal.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports,Date,require(name){if(name==='@/components/portal/portal-context')return {usePortal:()=>({isAdmin:true,basePath:'/admin'})};if(name==='@/lib/incidents/model')return load('model');if(name==='react')return{useState:v=>[v,()=>{}],useEffect(){}};if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/lib/incidents/report')return load('report');return{};}});
 const modal=exports.IncidentDetailModal({projectId:12,projectName:'La Colina',id:42,result:{incident,evidence:[]},onClose(){}});
 assert.equal(modal.props.title,'Nov 22, 2026');assert.equal(modal.props.description,'Reported by Trisha Bravo');
 const component=nodes(modal).find(n=>n.type?.name==='IncidentDetails');const detail=component.type(component.props);
 assert.match(text(detail),/Reported date:/);assert.match(text(detail),/10:10:38 PM/);assert.ok(!text(detail).includes('Minor'));
 const download=nodes(detail).find(n=>n.type==='button'&&text(n)==='Download as a report');assert.ok(download);assert.equal(download.props.disabled,false);assert.equal(typeof download.props.onClick,'function');
});


test('closed incident report and PDF include verified findings, actions and closeout evidence',async()=>{
 const closed={...incident,attachments:[{path:'12/u1/original.pdf',name:'incident-evidence.pdf',type:'application/pdf',size:1000}],closeout:{findings:'Materials blocked the access route.',actionTaken:'Cleared the route and briefed workers.',closedByName:'Project Manager',closedAt:'2026-11-23T02:00:00Z',attachments:[{path:'12/u2/action.pdf',name:'corrective-action.pdf',type:'application/pdf',size:1000}]}};
 const groups=load('report').incidentReportSections(closed);
 assert.equal(groups[0].rows.find(row=>row[0]==='Status')[1],'Closed');
 assert.equal(groups.at(-1).rows[0][1],closed.closeout.findings);
 const pdf=await load('report-pdf').createIncidentPdf(closed,'La Colina');const text=pdf.internal.pages.flat().join('\n');
 for(const expected of ['INCIDENT CLOSEOUT','Materials blocked the access route.','Cleared the route and briefed workers.','Project Manager','ATTACHMENTS','incident-evidence.pdf','corrective-action.pdf'])assert.ok(text.includes(expected),expected);
 assert.ok(!text.includes('CLOSEOUT ATTACHMENTS'));
});
