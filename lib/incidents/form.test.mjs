import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null?'':typeof value==='string'?value:Array.isArray(value)?value.map(text).join(''):text(value.props?.children);
function mount(save=async()=>({id:42})) {
 const state=[];let cursor=0;let submitted;
 const react={useId:()=> 'incident-test',useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];}};
 react.useRef=initial=>react.useState(()=>({current:initial}))[0];
 const jsx=(type,props)=>({type,props});const exports={};
 class Form extends FormData {constructor(initial){super();if(initial)for(const [key,value]of initial.entries())this.append(key,value);}}
 const code=ts.transpileModule(readFileSync('components/projects/progress/incident-report-panel.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports,FormData:Form,Date,Intl,JSON,console,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/lib/incidents/actions')return{reportIncident:async(id,form)=>{submitted=form;return save(id,form);}};if(name==='@/lib/incidents/model')return require('./model.ts');return{};}});
 let completed=0,closed=0;
 const props={projectId:12,context:{kind:'task',id:7,name:'Site Clearing'},active:true,onClose(){closed++;},onSubmitted(){completed++;}};
 const render=()=>{cursor=0;return exports.IncidentReportPanel(props);};
 return{render,get submitted(){return submitted;},get completed(){return completed;},get closed(){return closed;},submit:(overrides={})=>{const form=new FormData();for(const[k,v]of Object.entries({contextKind:'task',contextId:'7',occurredOn:'2026-01-02',occurredTime12:'2:30',severity:'minor',description:'Worker slipped.',...overrides}))form.set(k,v);return nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:form});}};
}
test('incident form uses a centered system modal and sections from the reference',()=>{
 const f=mount();const tree=f.render();assert.equal(tree.props.variant,'centered');assert.equal(tree.props.title,'Report Incident');
 for(const heading of ['Persons involved','Incident details','Injuries and medical attention','Attachments'])assert.ok(text(tree).includes(heading));
 assert.ok(!nodes(tree).some(n=>n.props?.name==='severity'));
 const injury=nodes(tree).find(n=>n.props?.name==='injuryDescription');assert.ok(injury);assert.equal(injury.props.required,false);
 assert.ok(!text(tree).includes('Date of report'));
 assert.ok(!nodes(tree).some(n=>n.type==='input'&&n.props.readOnly));
 assert.equal(nodes(tree).find(n=>n.props?.name==='description').props.rows,1);
 assert.equal(injury.props.rows,1);
 const date=nodes(tree).find(n=>n.props?.ariaLabel==='Incident date');assert.equal(date.props.required,true);assert.ok(date.props.max);
 nodes(tree).find(n=>n.props?.['aria-label']==='Add person involved').props.onClick();assert.equal(nodes(f.render()).filter(n=>n.props?.['aria-label']==='Remove person involved').length,2);
});
test('incident form requires incident types and medical answers before submission',async()=>{
 const f=mount();await f.submit();assert.equal(f.submitted,undefined);assert.match(text(f.render()),/Select at least one/);
 nodes(f.render()).find(n=>n.type?.name==='ChoiceInput'&&n.props['aria-label']==='Worker injury').props.onChange({target:{checked:true}});
 await f.submit();assert.equal(f.submitted,undefined);assert.match(text(f.render()),/Answer the injury/);
});
test('incident submission sends structured details, guards duplicate clicks, and preserves draft on failure',async()=>{
 let finish;const f=mount(()=>new Promise(resolve=>{finish=resolve;}));
 nodes(f.render()).find(n=>n.type?.name==='ChoiceInput'&&n.props['aria-label']==='Worker injury').props.onChange({target:{checked:true}});
 for(const field of nodes(f.render()).filter(n=>n.type?.name==='YesNo'))field.props.onChange(false);
 const saving=f.submit();assert.ok(nodes(f.render()).some(n=>n.type==='button'&&text(n)==='Submitting…'&&n.props.disabled));
 await f.submit();assert.equal(JSON.parse(f.submitted.get('details')).kinds[0],'injury');assert.equal(f.submitted.get('occurredOn'),'2026-01-02');
 finish({error:'Retry later'});await saving;assert.equal(f.completed,0);assert.match(text(f.render()),/Retry later/);
 assert.equal(nodes(f.render()).find(n=>n.type?.name==='ChoiceInput'&&n.props['aria-label']==='Worker injury').props.checked,true);
});


test('AM and PM are exclusive checkboxes and twelve-hour values convert accurately',()=>{
 const {incidentTime24}=require('./model.ts');
 for(const [time,period,expected] of [['12:00','AM','00:00'],['12:00','PM','12:00'],['9:53','PM','21:53'],['09:53','AM','09:53']])assert.equal(incidentTime24(time,period),expected);
 for(const time of ['0:00','13:30','9:60',''])assert.equal(incidentTime24(time,'AM'),null);
 const f=mount();let tree=f.render();
 assert.ok(!nodes(tree).some(n=>n.props?.type==='time'));
 nodes(tree).find(n=>n.type?.name==='ChoiceInput'&&n.props['aria-label']==='PM').props.onChange();
 tree=f.render();assert.equal(nodes(tree).find(n=>n.type?.name==='ChoiceInput'&&n.props['aria-label']==='PM').props.checked,true);assert.equal(nodes(tree).find(n=>n.type?.name==='ChoiceInput'&&n.props['aria-label']==='AM').props.checked,false);
});
test('incident and injury descriptions begin at one row and expand to fit typed text',()=>{
 const f=mount();for(const name of ['description','injuryDescription']){
  const field=nodes(f.render()).find(n=>n.props?.name===name);assert.equal(field.props.rows,1);
  const target={style:{},scrollHeight:80,offsetHeight:40,clientHeight:38};field.props.onInput({currentTarget:target});assert.equal(target.style.height,'82px');
  target.scrollHeight=20;field.props.onInput({currentTarget:target});assert.equal(target.style.height,'40px');
 }
});

 test('Other requires a custom description before sending the report',async()=>{
 const f=mount();nodes(f.render()).find(n=>n.type?.name==='ChoiceInput'&&n.props['aria-label']==='Other').props.onChange({target:{checked:true}});
 for(const field of nodes(f.render()).filter(n=>n.type?.name==='YesNo'))field.props.onChange(false);
 assert.equal(nodes(f.render()).find(n=>n.props?.name==='otherType').props.required,true);
 await f.submit();assert.equal(f.submitted,undefined);assert.match(text(f.render()),/Describe the other incident type/);
 await f.submit({otherType:'Temporary scaffold collapse'});assert.equal(JSON.parse(f.submitted.get('details')).otherType,'Temporary scaffold collapse');assert.equal(f.completed,1);
 });
