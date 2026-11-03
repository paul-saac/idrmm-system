"use server";

import { requireProjectAccess } from "@/lib/auth/project-access";
import { createClient } from "@/lib/supabase/server";
import { syncProjectStatusFromProgress } from "@/lib/projects/sync";
import { revalidateProjectLists, revalidateProjectPaths } from "@/lib/projects/revalidate";
import type { recordTaskProgress } from "@/lib/task-progress/actions";

export async function editProgressLog(projectId:number,kind:"task"|"category",itemId:number,logId:number,input:Parameters<typeof recordTaskProgress>[2]&{retainedMaterials?:{name:string;unit:string|null}[]}):Promise<{success?:boolean;error?:string}> {
  const profile=await requireProjectAccess(projectId,"edit");
  if(!profile) return {error:"You do not have permission to edit this project's saved logs."};
  if(![projectId,itemId,logId].every(id=>Number.isSafeInteger(id)&&id>0) || !["task","category"].includes(kind)) return {error:"Choose a valid saved log."};
  try {
    const client=await createClient();
    const {error}=await client.rpc("edit_saved_progress_log",{p_project_id:projectId,p_kind:kind,p_item_id:itemId,p_log_id:logId,p_input:input});
    if(error) {
      if(["22023","40001","42501","55000"].includes(error.code)) return {error:error.message};
      console.error("[editProgressLog] Save failed",{code:error.code});
      return {error:["PGRST202","42883"].includes(error.code) ? "Saved-log editing needs database migration 0127." : "Could not save the correction. The previous log is unchanged."};
    }
    await syncProjectStatusFromProgress(projectId);
    revalidateProjectLists();revalidateProjectPaths(projectId);
    return {success:true};
  } catch {return {error:"Could not confirm the saved correction. Reopen the task to check its latest records before retrying."};}
}
