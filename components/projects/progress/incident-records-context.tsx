"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Incident, IncidentContext } from "@/lib/incidents/model";

type Records = {items:Incident[];available:boolean};
type IncidentCache = Records & {replaceTaskIncidents:(context:Pick<IncidentContext,"kind"|"id">,items:Incident[])=>void};
const Context=createContext<IncidentCache|null>(null);
export const useIncidentRecords=()=>useContext(Context);
export function IncidentRecordsProvider({records,children}:{records:Records;children:ReactNode}) {
 const [changes,setChanges]=useState<Record<string,{context:Pick<IncidentContext,"kind"|"id">;items:Incident[]}>>({});
 const replaceTaskIncidents=useCallback((context:Pick<IncidentContext,"kind"|"id">,items:Incident[])=>setChanges(current=>({...current,[`${context.kind}-${context.id}`]:{context,items}})),[]);
 const items=useMemo(()=>{
  let result=records.items;
  for(const {context,items}of Object.values(changes))result=[...result.filter(item=>(context.kind==='task'?item.task_id:item.category_id)!==context.id),...items];
  return result;
 },[records.items,changes]);
 return <Context.Provider value={{items,available:records.available || Object.keys(changes).length>0,replaceTaskIncidents}}>{children}</Context.Provider>;
}
