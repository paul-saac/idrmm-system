import type { OverrideLog } from "./types";
import type { Worker } from "@/lib/workers/data";

/** Negative IDs identify a legacy attendance position, never a different person
 * guessed from their name. The save RPC resolves it against the stored record. */
export function logEditor(log: OverrideLog, team: Worker[], assigned: Worker[] = []) {
  const attendance = log.attendance.map((row,index) => ({...row,workerId:row.workerId ?? -(index+1)}));
  const workers = attendance.map(row => {
    const person = team.find(worker => worker.id === row.workerId);
    return {...person,id:row.workerId,fullName:row.name,hourlyRate:row.rate,
      title:person?.title ?? "Recorded worker",category:"skilled",employmentType:row.amount != null ? "subcontractor" : "employee",
      contactNumber:person?.contactNumber ?? null,dateHired:person?.dateHired ?? null,
      subcontractorCompany:null,profileId:person?.profileId ?? null,workHours:person?.workHours ?? [0,0,0,0,0,0,0]} satisfies Worker;
  });
  // Keep every assigned person visible, even if a mistaken/zero log recorded
  // nobody. Legacy name matching only avoids duplicate display; negative IDs
  // still resolve against stored attendance on the server, never a guessed ID.
  const crew = [
    ...assigned.map(person=>workers.find(saved=>saved.id===person.id) ?? person).filter(person=>
      !workers.some(saved=>saved.id<0 && saved.fullName===person.fullName && team.filter(candidate=>candidate.fullName===person.fullName).length===1)),
    ...workers.filter(saved=>!assigned.some(person=>person.id===saved.id)),
  ];
  return {log:{...log,attendance},workers,crew};
}
