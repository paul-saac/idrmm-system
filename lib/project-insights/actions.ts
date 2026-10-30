"use server";

import { createHash } from "node:crypto";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { loadInsightContext } from "./data";
import { requestInsightAnalysis } from "./provider";
import type { ProjectInsights, ProjectInsightsResult } from "./types";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string,{signature:string;expires:number;data:ProjectInsights}>();
const pending = new Map<string,Promise<ProjectInsights>>();

/** Advisory read only: no project values, statuses, or saved logs are written. */
export async function generateProjectInsights(projectId: number): Promise<ProjectInsightsResult> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return {error:"Choose a valid project."};
  const profile = await requireProjectAccess(projectId,"view");
  if (!profile) return {error:"You do not have access to this project's insights."};
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return {error:"AI insights are not available yet. Please contact your system administrator."};
  try {
    const context = await loadInsightContext(projectId);
    if (!context.summary.workItemCount) return {empty:true};
    const signature = createHash("sha256").update(JSON.stringify(context)).digest("hex");
    const actorKey = `${profile.id}:${projectId}`;
    const requestKey = `${actorKey}:${signature}`;
    const previous = cache.get(actorKey);
    if (previous?.signature === signature && previous.expires > Date.now()) return {data:previous.data};
    const existing = pending.get(requestKey);
    if (existing) return {data:await existing};
    // Bound process-local work as well as response size on the free provider.
    if (pending.size >= 8) return {error:"AI insights are busy. Please try again shortly."};
    const request = (async () => {
      const analysis = await requestInsightAnalysis(context,apiKey);
      const data: ProjectInsights = {...analysis,projectId,asOfDate:context.asOfDate,generatedAt:new Date().toISOString()};
      // Permissions are checked before every lookup and again after the
      // external request, including projects that are view-only or archived.
      if (!await requireProjectAccess(projectId,"view")) throw new Error("You no longer have access to this project's insights.");
      cache.delete(actorKey);
      cache.set(actorKey,{signature,expires:Date.now()+TTL_MS,data});
      while (cache.size > 32) cache.delete(cache.keys().next().value!);
      return data;
    })();
    pending.set(requestKey,request);
    try { return {data:await request}; }
    finally { pending.delete(requestKey); }
  } catch (error) {
    return {error:error instanceof Error ? error.message : "Could not prepare project insights. Please try again."};
  }
}
