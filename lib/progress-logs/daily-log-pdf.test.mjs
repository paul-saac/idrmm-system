import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
async function report(log){
 let pdf;const fetched=[];const {jsPDF}=require('jspdf');
 class ReportPdf extends jsPDF{constructor(options){super(options);pdf=this;}save(){return this;}}
 const exports={};const code=ts.transpileModule(readFileSync('lib/progress-logs/daily-log-pdf.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(code,{exports,Date,Intl,fetch:async url=>{fetched.push(url);return{ok:false};},require(name){
  if(name==='jspdf')return{jsPDF:ReportPdf};
  if(name==='./evidence')return{progressPhotoUrl:(projectId,photo)=>`/api/progress-photos?projectId=${projectId}&path=${encodeURIComponent(photo.path)}`};
  if(name==='@/lib/task-progress/labor')return{laborEntryCost:worker=>worker.amount??worker.hours*worker.rate};
  if(name==='@/lib/incidents/model')return require('../incidents/model.ts');throw new Error(name);
 }});
 await exports.downloadDailyLogPdf({projectId:12,projectName:'Test Project',workItemName:'Site Clearing',unit:'sq.m.',log,incidents:[{incident_type:'injury',severity:'minor',occurred_on:'2026-11-22',occurred_time:'14:30',description:'Incident description',reporter_name:'Foreman',attachments:[]}]});
 return{text:pdf.internal.pages.flat().join('\n'),fetched};
}
const log={entryDate:'2026-11-22',createdAt:'2026-11-22T06:00:00Z',savedByName:'Trisha Bravo',quantityCompleted:12,costs:{labor:0,material:0,equipment:0,other:0},attendance:[],materialsUsed:[],equipmentCosts:[],otherCosts:[]};
test('daily log PDF includes saved remarks and attachment names before incidents with authorized image access',async()=>{
 const result=await report({...log,remarks:'Work stopped while the area was made safe.',photos:[{path:'12/user/site.jpg',name:'Site evidence.jpg',type:'image/jpeg',size:100}]});
 const remarks=result.text.indexOf('REMARKS / SITE OBSERVATIONS'),attachments=result.text.indexOf('ATTACHMENTS'),incidents=result.text.indexOf('INCIDENT REPORTS');assert.ok(remarks>0&&attachments>remarks&&incidents>attachments);
 assert.match(result.text,/Work stopped while the area was made safe/);assert.match(result.text,/Site evidence.jpg/);assert.match(result.fetched[0],/^\/api\/progress-photos\?projectId=12&path=12%2Fuser%2Fsite.jpg$/);
});
test('daily log PDF shows clear empty remarks and attachments instead of dropping the sections',async()=>{
 const result=await report({...log,remarks:'',photos:[]});assert.match(result.text,/No remarks recorded\./);assert.match(result.text,/No attachments\./);assert.equal(result.fetched.length,0);
});
