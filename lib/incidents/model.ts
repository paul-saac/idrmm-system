export const INCIDENT_TYPES = {
  injury: "Injury", near_miss: "Near miss", equipment_damage: "Equipment damage",
  property_damage: "Property damage", other: "Other",
} as const;
export const INCIDENT_SEVERITIES = { minor: "Minor", moderate: "Moderate", serious: "Serious" } as const;
export type IncidentContext = { kind: "task" | "category"; id: number; name: string };
export type IncidentAttachment = { path: string; name: string; type: string; size: number; url?: string | null };
export type Incident = {
  id: number; project_id: number; task_id: number | null; category_id: number | null;
  context_name: string; log_date: string; incident_type: keyof typeof INCIDENT_TYPES;
  severity: keyof typeof INCIDENT_SEVERITIES; occurred_on: string; occurred_time: string;
  location: string; description: string; attachments: IncidentAttachment[];
  offline_submission_id?: string | null;
  details?: IncidentDetails;
  closeout?: IncidentCloseout | null;
  reported_by: string; reporter_name: string; created_at: string;
};
export const MAX_INCIDENT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INCIDENT_TOTAL_BYTES = 15 * 1024 * 1024;
export const MAX_INCIDENT_FILES = 5;
export const INCIDENT_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];

export function validateIncidentFiles(files: { name: string; size: number; type: string }[]): string | null {
  if (files.length > MAX_INCIDENT_FILES) return "Attach up to 5 photos or documents.";
  for (const file of files) {
    if (!INCIDENT_MIME_TYPES.includes(file.type)) return "Use JPG, PNG, or PDF files.";
    if (!file.size || file.size > MAX_INCIDENT_FILE_BYTES) return "Each attachment must be between 1 byte and 10 MB.";
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_INCIDENT_TOTAL_BYTES) return "Attachments must total 15 MB or less.";
  return null;
}

export function isIncidentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const INCIDENT_KINDS = {
 injury: "Worker injury", equipment_damage: "Equipment incident", fall_slip: "Fall / slip",
 property_damage: "Property / material damage", excavation: "Excavation / trenching", fire: "Fire / explosion",
 vehicle: "Vehicle incident", hazardous_exposure: "Hazardous substance exposure", near_miss: "Near miss", other: "Other",
} as const;
export type IncidentDetails = {
 people: {name:string;role:string;contact:string}[];
 kinds: (keyof typeof INCIDENT_KINDS)[]; otherType:string;
 injured:boolean; injuryDescription:string; firstAid:boolean; hospitalTransport:boolean; medicalProvider:string;
};
/** Validate structured report fields before uploading files or writing records. */
export function parseIncidentDetails(raw:string): IncidentDetails {
 const value=JSON.parse(raw);
 if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Review the incident details.");
 const limited=(text:unknown,max:number)=>{if(typeof text!=="string" || text.length>max)throw new Error("Some incident details exceed the allowed length.");return text.trim();};
 if(!Array.isArray(value.people)||value.people.length>10)throw new Error("Include up to 10 people involved.");
 const people=value.people.map((person: Record<string,unknown>)=>{
  if(!person || typeof person!=="object")throw new Error("Review the people involved.");
  const result={name:limited(person.name,200),role:limited(person.role,150),contact:limited(person.contact,200)};
  if(!result.name)throw new Error("Enter the name of each person involved, or remove the empty row.");return result;
 });
 if(!Array.isArray(value.kinds)||!value.kinds.length||value.kinds.length>10||value.kinds.some((kind:unknown)=>typeof kind!=="string"||!Object.hasOwn(INCIDENT_KINDS,kind)))throw new Error("Select at least one incident type.");
 for(const key of ["injured","firstAid","hospitalTransport"])if(typeof value[key]!=="boolean")throw new Error("Answer the injury and medical attention questions.");
 const result={people,kinds:[...new Set(value.kinds)] as IncidentDetails["kinds"],otherType:limited(value.otherType,200),injured:value.injured,injuryDescription:limited(value.injuryDescription,2000),firstAid:value.firstAid,hospitalTransport:value.hospitalTransport,medicalProvider:limited(value.medicalProvider,300)};
 if(result.kinds.includes("other")&&!result.otherType)throw new Error("Describe the other incident type.");
 if(result.injured&&!result.injuryDescription)throw new Error("Describe the injury.");
 return result;
}

export function incidentTitle(incident:Pick<Incident,"incident_type"|"details">) {
 return incident.details?.kinds?.length ? incident.details.kinds.map(kind=>kind==="other" ? incident.details?.otherType?.trim() || INCIDENT_KINDS.other : INCIDENT_KINDS[kind]).join(", ") : INCIDENT_TYPES[incident.incident_type];
}

/** Store local incident time as HH:mm while the form uses an explicit AM/PM choice. */
export function incidentTime24(value:string,period:"AM"|"PM") {
 const match=/^(0?[1-9]|1[0-2]):([0-5]\d)$/.exec(value.trim());
 if(!match)return null;
 const hour=Number(match[1])%12+(period==="PM"?12:0);
 return `${String(hour).padStart(2,"0")}:${match[2]}`;
}

export type IncidentCloseout = {
 findings: string; actionTaken: string; attachments: IncidentAttachment[];
 closedBy: string; closedByName: string; closedAt: string;
};
export const incidentStatus = (incident: Pick<Incident, "closeout">) => incident.closeout ? "Closed" : "Open";
export function validateIncidentCloseout(findings: string, actionTaken: string) {
 if (!findings.trim() || findings.trim().length > 5000) return "Enter investigation findings using up to 5,000 characters.";
 if (!actionTaken.trim() || actionTaken.trim().length > 5000) return "Enter the action taken using up to 5,000 characters.";
 return null;
}
