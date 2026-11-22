"use client";

import { AttachmentLink } from "@/components/ui/attachment-viewer";
import { RequiredMark } from "@/components/ui/required-mark";
import { DatePicker } from "@/components/ui/date-picker";
import { useId, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Flag, Paperclip, Plus, X } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { reportIncident } from "@/lib/incidents/actions";
import { INCIDENT_KINDS, incidentTime24, validateIncidentFiles, type IncidentContext, type IncidentDetails } from "@/lib/incidents/model";

const input = "h-10 w-full min-w-0 rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 placeholder:text-zinc-400";
const label = "grid min-w-0 gap-2 text-xs font-medium text-zinc-700";
function ChoiceInput(props:InputHTMLAttributes<HTMLInputElement>) {
 return <span className="relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center align-middle"><input {...props} className="peer m-0 block box-border h-[14px] w-[14px] min-w-[14px] shrink-0 cursor-pointer appearance-none rounded-none border border-zinc-300 bg-white p-0 checked:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:outline-none"/><span className="pointer-events-none absolute top-1/2 left-1/2 block h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-none bg-zinc-900 opacity-0 peer-checked:opacity-100"/></span>;
}
function growText(event:FormEvent<HTMLTextAreaElement>) {
 const field=event.currentTarget;field.style.height="auto";
 field.style.height=`${Math.max(40,field.scrollHeight+field.offsetHeight-field.clientHeight)}px`;
}
const section = "space-y-4 border-b border-zinc-200 px-6 py-5 last:border-b-0";
function YesNo({name,children,value,onChange}:{name:string;children:React.ReactNode;value:boolean|null;onChange:(value:boolean)=>void}) {
 return <fieldset className="space-y-2"><legend className="text-xs font-medium text-zinc-700">{children} <RequiredMark /></legend><div className="flex gap-5 text-sm">{[true,false].map(answer=><label key={String(answer)} className="flex items-center gap-2"><ChoiceInput type="radio" name={name} required checked={value===answer} onChange={()=>onChange(answer)} />{answer ? "Yes" : "No"}</label>)}</div></fieldset>;
}
export function IncidentReportPanel({ projectId, context, active, onClose, onSubmitted, embedded = false }: {
 projectId:number;context:IncidentContext;active:boolean;embedded?:boolean;onClose:()=>void;onSubmitted?:(id:number)=>void;
}) {
 const formId=useId();const fileInput=useRef<HTMLInputElement>(null);
 const [files,setFiles]=useState<File[]>([]);const [error,setError]=useState("");const [pending,setPending]=useState(false);
 const [people,setPeople]=useState([{key:0,name:"",role:"",contact:""}]);const nextPerson=useRef(1);
 const [period,setPeriod]=useState<"AM"|"PM">("AM");
 const [kinds,setKinds]=useState<IncidentDetails["kinds"]>([]);
 const [injured,setInjured]=useState<boolean|null>(null);const [firstAid,setFirstAid]=useState<boolean|null>(null);const [hospital,setHospital]=useState<boolean|null>(null);
 const [today]=useState(()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));
 function addFiles(incoming:File[]) {const next=[...files,...incoming];const issue=validateIncidentFiles(next);if(issue){setError(issue);return;}setError("");setFiles(next);}
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(pending)return;const form=new FormData(event.currentTarget);
  if(!kinds.length){setError("Select at least one incident type.");return;}
  if(injured===null||firstAid===null||hospital===null){setError("Answer the injury and medical attention questions.");return;}
  if(kinds.includes("other")&&!String(form.get("otherType")??"").trim()){setError("Describe the other incident type.");return;}
  const time=incidentTime24(String(form.get("occurredTime12")??""),period);
  if(!time){setError("Enter a time from 1:00 to 12:59 and choose AM or PM.");return;}
  form.set("occurredTime",time);
  const issue=validateIncidentFiles(files);if(issue){setError(issue);return;}
  const primary=kinds.find(kind=>["injury","equipment_damage","property_damage","near_miss","other"].includes(kind))??"other";
  form.set("incidentType",primary);
  form.set("severity","minor");
  form.set("details",JSON.stringify({people:people.filter(p=>p.name.trim()||p.role.trim()||p.contact.trim()).map(({name,role,contact})=>({name,role,contact})),kinds,otherType:String(form.get("otherType")??""),injured,injuryDescription:String(form.get("injuryDescription")??""),firstAid,hospitalTransport:hospital,medicalProvider:String(form.get("medicalProvider")??"")}));
  files.forEach(file=>form.append("attachments",file));setPending(true);setError("");
  try {const result=await reportIncident(projectId,form);if(result.error)setError(result.error);else if(result.id)onSubmitted?.(result.id);}
  catch {setError("Could not submit the incident. Your entries are still here; please try again.");}
  finally {setPending(false);}
 }
 const body=<>
  <form id={formId} onSubmit={submit} autoComplete="off" className="-mx-6 -my-5">
   <input type="hidden" name="contextKind" value={context.kind}/><input type="hidden" name="contextId" value={context.id}/>
   <fieldset disabled={pending}>

    <section className={section}><div className="flex items-center gap-2"><h3 className="text-base font-semibold text-zinc-900">Persons involved</h3><button type="button" aria-label="Add person involved" disabled={people.length>=10} onClick={()=>setPeople(current=>[...current,{key:nextPerson.current++,name:"",role:"",contact:""}])} className="p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-40"><Plus className="size-4"/></button></div>
     {people.map(person=><div key={person.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"><div className="grid gap-3 sm:grid-cols-3">{([['name','Name',200],['role','Role',150],['contact','Contact information',200]] as const).map(([key,title,max])=><label key={key} className={label}>{title}<input value={person[key]} maxLength={max} onChange={e=>setPeople(current=>current.map(p=>p.key===person.key?{...p,[key]:e.target.value}:p))} className={input}/></label>)}</div><button type="button" aria-label="Remove person involved" onClick={()=>setPeople(current=>current.filter(p=>p.key!==person.key))} className="mb-2.5 p-1 text-zinc-400 hover:text-red-600"><X className="size-4"/></button></div>)}
    </section>
    <section className={`${section} bg-zinc-50/60`}><h3 className="text-base font-semibold text-zinc-900">Incident details</h3><div className="grid gap-4 sm:grid-cols-2"><label className={label}><span>Date <RequiredMark/></span><DatePicker name="occurredOn" defaultValue={today} max={today} required ariaLabel="Incident date" className={input}/></label><fieldset className="min-w-0"><legend className="mb-2 text-xs font-medium text-zinc-700">Time <RequiredMark/></legend><div className="flex h-10 items-center gap-4"><input name="occurredTime12" aria-label="Incident time" placeholder="hh:mm" pattern="(0?[1-9]|1[0-2]):[0-5][0-9]" maxLength={5} required className={`${input} flex-1`}/><div className="flex shrink-0 items-center gap-3">{(["AM","PM"] as const).map(choice=><label key={choice} className="flex items-center gap-1.5 text-xs text-zinc-700"><ChoiceInput type="checkbox" aria-label={choice} checked={period===choice} onChange={()=>setPeriod(choice)}/>{choice}</label>)}</div></div></fieldset></div>
     <label className={label}>Location<input name="location" maxLength={300} className={input}/></label>
     <fieldset><legend className="mb-3 text-xs font-medium text-zinc-700">Type of incident (check all that apply) <RequiredMark/></legend><div className="grid gap-3 sm:grid-cols-3">{Object.entries(INCIDENT_KINDS).map(([key,text])=><label key={key} className="flex items-center gap-2 text-sm text-zinc-700"><ChoiceInput type="checkbox" aria-label={text} checked={kinds.includes(key as keyof typeof INCIDENT_KINDS)} onChange={e=>setKinds(current=>e.target.checked?[...current,key as keyof typeof INCIDENT_KINDS]:current.filter(k=>k!==key))}/>{text}</label>)}</div></fieldset>
     {kinds.includes('other')&&<label className={label}><span>Other incident type <RequiredMark/></span><input name="otherType" required maxLength={200} className={input}/></label>}
     <label className={label}><span>Describe the incident <RequiredMark/></span><textarea name="description" required maxLength={5000} rows={1} onInput={growText} className={`${input} min-h-10 resize-y overflow-hidden py-2 leading-5`}/></label>
    </section>
    <section className={section}><h3 className="text-base font-semibold text-zinc-900">Injuries and medical attention</h3><YesNo name="injured" value={injured} onChange={setInjured}>Was anyone injured?</YesNo>
     <label className={label}><span>Describe the injury {injured && <RequiredMark/>}</span><textarea name="injuryDescription" required={injured===true} maxLength={2000} rows={1} onInput={growText} className={`${input} min-h-10 resize-y overflow-hidden py-2 leading-5`}/></label>
     <div className="grid gap-4 sm:grid-cols-2"><YesNo name="firstAid" value={firstAid} onChange={setFirstAid}>Was first aid administered?</YesNo><YesNo name="hospitalTransport" value={hospital} onChange={setHospital}>Was EMS / hospital transport required?</YesNo></div>
     <label className={label}>First responder / medical provider<input name="medicalProvider" maxLength={300} className={input}/></label>
    </section>
    <section className={`${section} bg-zinc-50/60`}><h3 className="text-base font-semibold text-zinc-900">Attachments</h3><input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,application/pdf" aria-label="Incident attachments" className="sr-only" onChange={e=>{addFiles(Array.from(e.target.files??[]));e.target.value="";}}/><button type="button" onClick={()=>fileInput.current?.click()} className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-zinc-300 bg-white px-4 py-5 text-sm text-zinc-700"><Paperclip className="size-4"/>Add attachments</button>
     {!!files.length&&<ul className="space-y-2">{files.map((file,index)=><li key={`${file.name}-${index}`} className="flex items-center gap-2 text-xs"><AttachmentLink url="" name={file.name} file={file} className="min-w-0 flex-1 truncate underline underline-offset-2">{file.name}</AttachmentLink><button type="button" aria-label={`Remove ${file.name}`} onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))} className="p-1 text-zinc-400 hover:text-red-600"><X className="size-4"/></button></li>)}</ul>}
    </section>
   </fieldset>
   {error&&<p role="alert" className="px-6 pb-5 text-sm text-red-600">{error}</p>}
  </form>
  <ModalFooter><button type="button" disabled={pending} onClick={onClose} className="rounded border border-zinc-200 px-4 py-2 text-sm">Cancel</button><button type="submit" form={formId} disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending?"Submitting…":"Submit incident"}</button></ModalFooter>
 </>;
 return embedded ? body : <Modal open={active} onClose={()=>{if(!pending)onClose();}} title="Report Incident" variant="centered" size="wide" icon={<Flag className="size-5" />} className="compact-text">{body}</Modal>;
}
