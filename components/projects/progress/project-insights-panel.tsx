"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { generateProjectInsights } from "@/lib/project-insights/actions";
import type { ProjectInsightDestination, ProjectInsightsResult } from "@/lib/project-insights/types";

export function ProjectInsightsPanel({ projectId, onNavigate }: {
  projectId:number;
  onNavigate:(destination:ProjectInsightDestination)=>void;
}) {
  const [result,setResult] = useState<ProjectInsightsResult | null>(null);
  const [loading,setLoading] = useState(true);
  const [refresh,setRefresh] = useState(0);
  useEffect(()=>{
    let current = true;
    generateProjectInsights(projectId).then(value=>{
      if (current) { setResult(value); setLoading(false); }
    }).catch(()=>{
      if (current) { setResult({error:"Could not load AI insights. Please try again."}); setLoading(false); }
    });
    return ()=>{current=false;};
  },[projectId,refresh]);
  function refreshInsights() {
    setLoading(true);
    setResult(null);
    setRefresh(value=>value+1);
  }

  if (loading) return <div role="status" className="space-y-6 text-sm text-zinc-300">
    <p className="flex items-center gap-2"><RefreshCw aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />Reviewing saved project data…</p>
    <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
      {[0,1,2].map(index=><div key={index} className="space-y-3"><div className="h-4 w-2/5 rounded bg-white/10" /><div className="h-3 w-full rounded bg-white/10" /><div className="h-3 w-5/6 rounded bg-white/10" /><div className="h-3 w-3/4 rounded bg-white/10" /></div>)}
    </div>
  </div>;
  if (result?.empty) return <p className="text-sm leading-relaxed text-zinc-300">Add project tasks and Planned costs to start receiving project insights. Insights will use the saved records available when you open this panel.</p>;
  if (result?.error || !result?.data) return <div className="space-y-4 text-sm text-zinc-200">
    <p role="alert">{result?.error || "AI insights are unavailable. Please try again."}</p>
    <button type="button" onClick={refreshInsights} className="inline-flex cursor-pointer items-center gap-2 rounded border border-zinc-600 px-3 py-2 text-xs font-medium hover:bg-white/5"><RefreshCw aria-hidden="true" className="size-3.5" />Try again</button>
  </div>;
  const data = result.data;
  const generated = new Date(data.generatedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
  return <article className="space-y-5 text-sm leading-relaxed text-zinc-200">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
      <p className="text-xs text-zinc-400">Generated {generated}</p>
      <button type="button" onClick={refreshInsights} className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-zinc-600 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/5"><RefreshCw aria-hidden="true" className="size-3.5" />Refresh insights</button>
    </div>
    <section><h3 className="text-base font-semibold text-zinc-100">Executive Summary</h3><p className="mt-3 whitespace-pre-line">{data.summary}</p></section>
    <section>
      <h3 className="text-base font-semibold text-zinc-100">Potential Risks and Recommendations</h3>
      {data.findings.length ? <ol className="mt-3 list-decimal space-y-5 pl-6">
        {data.findings.map(finding=><li key={finding.id}>
          <button type="button" onClick={()=>onNavigate(finding.destination)} className="block w-full cursor-pointer rounded text-left transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400" title="Open related project data">
            <strong className="text-zinc-100">{finding.title}:</strong> {finding.evidence}
          </button>
          <p className="mt-2 pl-4"><strong className="text-zinc-100">Recommendation:</strong> {finding.recommendation}</p>
        </li>)}
      </ol> : <p className="mt-3 text-zinc-300">No specific concerns were identified in the saved records reviewed.</p>}
    </section>
    <p className="border-t border-white/10 pt-4 text-xs text-zinc-400">Based on saved project records as of {data.asOfDate}. Review these suggestions before making project decisions.</p>
  </article>;
}
