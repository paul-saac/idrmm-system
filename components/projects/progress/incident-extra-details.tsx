import { INCIDENT_KINDS, type IncidentDetails } from "@/lib/incidents/model";

/** Structured report information; historical simple reports have no details. */
export function IncidentExtraDetails({details}:{details?:IncidentDetails}) {
 if(!details?.kinds)return null;
 return <div className="space-y-5 text-sm">
  <section><h4 className="mb-3 text-sm font-semibold text-zinc-800">Persons involved</h4>{details.people.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-zinc-50 text-zinc-500"><tr>{['Name','Role','Contact information'].map(name=><th key={name} className="border border-zinc-200 px-3 py-2 font-medium">{name}</th>)}</tr></thead><tbody>{details.people.map((person,index)=><tr key={index}>{[person.name,person.role,person.contact].map((value,i)=><td key={i} className="border border-zinc-200 px-3 py-2">{value||'—'}</td>)}</tr>)}</tbody></table></div>:<p className="text-xs text-zinc-400">No persons recorded.</p>}</section>
  <dl className="grid gap-4 sm:grid-cols-2">
   <div className="sm:col-span-2"><dt className="text-xs text-zinc-500">Incident types</dt><dd className="mt-1">{details.kinds.map(kind=>kind==='other'&&details.otherType?`Other: ${details.otherType}`:INCIDENT_KINDS[kind]).join(', ')}</dd></div>
   <div><dt className="text-xs text-zinc-500">Anyone injured?</dt><dd className="mt-1">{details.injured?'Yes':'No'}</dd></div>
   <div><dt className="text-xs text-zinc-500">First aid administered?</dt><dd className="mt-1">{details.firstAid?'Yes':'No'}</dd></div>
   {details.injured&&<div className="sm:col-span-2"><dt className="text-xs text-zinc-500">Injury description</dt><dd className="mt-1 whitespace-pre-wrap">{details.injuryDescription}</dd></div>}
   <div><dt className="text-xs text-zinc-500">EMS / hospital transport required?</dt><dd className="mt-1">{details.hospitalTransport?'Yes':'No'}</dd></div>
   <div><dt className="text-xs text-zinc-500">First responder / medical provider</dt><dd className="mt-1">{details.medicalProvider||'Not recorded'}</dd></div>
  </dl>
 </div>;
}
