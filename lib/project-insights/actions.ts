"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { loadInsightContext } from "./data";
import { requestInsightAnalysis } from "./provider";
import type { ProjectInsights, ProjectInsightsResult } from "./types";
import { getAIProvider } from "@/lib/ai/provider";

const pending = new Map<number,Promise<ProjectInsights>>();

/** Advisory read only: no project values, statuses, or saved logs are written. */
export async function generateProjectInsights(projectId: number, refresh = false): Promise<ProjectInsightsResult> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return {error:"Choose a valid project."};
  const profile = await requireProjectAccess(projectId,"view");
  if (!profile) return {error:"You do not have access to this project's insights."};
  try {
    const client = await createClient();
    const saved = await client.from("project_ai_insights").select("analysis").eq("project_id",projectId).maybeSingle();
    if (saved.error) return {error:"Could not load saved insights. Check database migration 0126 and try again."};
    if (!refresh && saved.data) return {data:saved.data.analysis as ProjectInsights};
    const existing = pending.get(projectId);
    if (existing) {
      const data = await existing;
      if (!await requireProjectAccess(projectId,"view")) return {error:"You no longer have access to this project's insights."};
      return {data};
    }
    if (pending.size >= 8) return {error:"AI insights are busy. Please try again shortly."};
    const request = (async () => {
      const context = await loadInsightContext(projectId);
      if (!context.summary.workItemCount) throw new Error("Add project tasks before generating insights.");
      const provider = getAIProvider();
      const analysis = await requestInsightAnalysis(context,provider);
      const data: ProjectInsights = {...analysis,schedule:context.schedule,projectId,asOfDate:context.asOfDate,generatedAt:new Date().toISOString()};
      // Permissions are checked before every lookup and again after the
      // external request, including projects that are view-only or archived.
      if (!await requireProjectAccess(projectId,"view")) throw new Error("You no longer have access to this project's insights.");
      const {error} = await client.from("project_ai_insights").upsert({project_id:projectId,analysis:data,
        generated_by:profile.id,generated_at:data.generatedAt});
      if (error) throw new Error("Could not save the new insights. Your previous insights are unchanged. Please try again.");
      return data;
    })();
    pending.set(projectId,request);
    try { return {data:await request}; }
    finally { pending.delete(projectId); }
  } catch (error) {
    if (error instanceof Error && error.message === "Add project tasks before generating insights.") return {empty:true};
    return {error:error instanceof Error ? error.message : "Could not prepare project insights. Please try again."};
  }
}
