import { incidentTitle, incidentStatus, type Incident } from "./model";

export type IncidentReportSection = {title:string;columns:string[];rows:string[][]};
export function incidentReportedDate(value:string) {
 return new Date(value).toLocaleString("en-US",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true});
}
export function incidentOccurrenceTime(value:string) {
 const [hour,minute]=value.split(":");const h=Number(hour);
 return `${h%12||12}:${minute} ${h>=12?"PM":"AM"}`;
}
export function incidentReportSections(incident:Incident):IncidentReportSection[] {
 const sections:IncidentReportSection[]=[{title:"Incident details",columns:["Field","Details"],rows:[
  ["Incident type",incidentTitle(incident)],
  ["Status",incidentStatus(incident)],
  ["Task / Phase",incident.context_name || "Project incident"],
  ["Date occurred",new Date(`${incident.occurred_on}T00:00:00Z`).toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"})],
  ["Time occurred",incidentOccurrenceTime(incident.occurred_time)],
  ["Location",incident.location || "Not recorded"],
  ["Describe the incident",incident.description],
 ]}];
 const details=incident.details;
 if(details?.kinds){
  sections.push({title:"Persons involved",columns:["Name","Role","Contact information"],rows:details.people.length?details.people.map(person=>[person.name,person.role||"Not recorded",person.contact||"Not recorded"]):[["No persons recorded.","",""]]});
  sections.push({title:"Injuries and medical attention",columns:["Field","Details"],rows:[
   ["Was anyone injured?",details.injured?"Yes":"No"],
   ["Describe the injury",details.injuryDescription || "Not recorded"],
   ["First aid administered?",details.firstAid?"Yes":"No"],
   ["EMS / hospital transport required?",details.hospitalTransport?"Yes":"No"],
   ["First responder / medical provider",details.medicalProvider||"Not recorded"],
  ]});
 }
 if(incident.closeout)sections.push({title:"Incident closeout",columns:["Field","Details"],rows:[
  ["Investigation findings",incident.closeout.findings],
  ["Action taken",incident.closeout.actionTaken],
  ["Closed by",incident.closeout.closedByName || "Project member"],
  ["Closed on",incidentReportedDate(incident.closeout.closedAt)],
 ]});
 return sections;
}
