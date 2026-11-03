"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AiGenerationStatus } from "@/components/ui/ai-generation-status";
import { generateProjectInsights } from "@/lib/project-insights/actions";
import type { ProjectInsightDestination, ProjectInsightsResult } from "@/lib/project-insights/types";

export function ProjectInsightsPanel({ projectId }: {
  projectId:number;
  onNavigate:(destination:ProjectInsightDestination)=>void;
}) {
  const [result,setResult] = useState<ProjectInsightsResult | null>(null);
  const [loading,setLoading] = useState(true);
  const [refresh,setRefresh] = useState(0);
  useEffect(()=>{
    let current = true;
    generateProjectInsights(projectId, refresh > 0).then(value=>{
      if (current) { setResult(previous => value.error && previous?.data ? { ...previous, error: value.error } : value); setLoading(false); }
    }).catch(()=>{
      if (current) { setResult(previous => ({...previous,error:"Could not load AI insights. Please try again."})); setLoading(false); }
    });
    return ()=>{current=false;};
  },[projectId,refresh]);
  function refreshInsights() {
    setLoading(true);
    setRefresh(value=>value+1);
  }

  if (loading) return <div className="space-y-3 py-4">
    <AiGenerationStatus label={refresh > 0 ? "AI is generating project insights" : "Loading project insights"} />
    <p className="text-xs text-zinc-400">{refresh > 0 ? "Reviewing the latest saved project records." : "Loading your saved review, or preparing the first review for this project."}</p>
  </div>;
  if (result?.empty) return <p className="text-sm leading-relaxed text-zinc-300">Add project tasks to prepare the first project insights. Later reviews are generated only when you select Refresh insights.</p>;
  if (!result?.data) return <div className="space-y-4 text-sm text-zinc-200">
    <p role="alert">{result?.error || "AI insights are unavailable. Please try again."}</p>
    <button type="button" onClick={refreshInsights} className="inline-flex cursor-pointer items-center gap-2 rounded border border-zinc-600 px-3 py-2 text-xs font-medium hover:bg-white/5"><RefreshCw aria-hidden="true" className="size-3.5" />Try again</button>
  </div>;
  const data = result.data;
  const schedule = data.schedule;
  const riskLabels = {low:"Low",medium:"Medium",high:"High",unassessed:"Not assessed",completed:"Completed"};
  const day = (value: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "Not available";
  const generated = new Date(data.generatedAt).toLocaleString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
  return <article className="space-y-5 text-sm leading-relaxed text-zinc-200">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
      <div className="text-xs text-zinc-400"><p>Generated {generated}</p><p className="mt-1">Refresh to review the latest project data.</p></div>
      <button type="button" onClick={refreshInsights} className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-zinc-600 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/5"><RefreshCw aria-hidden="true" className="size-3.5" />Refresh insights</button>
    </div>
    {result.error && <p role="alert" className="text-sm text-amber-200">{result.error} Showing the previous saved review.</p>}
    <section><h3 className="text-base font-semibold text-zinc-100">Executive Summary</h3><p className="mt-3 whitespace-pre-line">{data.summary}</p></section>
    {schedule && <section className="border-y border-white/10 py-4">
      <h3 className="text-base font-semibold text-zinc-100">Delay Risk and Completion Forecast</h3>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2">
        <dt className="text-zinc-400">Delay risk</dt><dd>{riskLabels[schedule.risk]}</dd>
        <dt className="text-zinc-400">Official target</dt><dd>{day(schedule.targetDate)}</dd>
        <dt className="text-zinc-400">Forecast completion</dt><dd>{day(schedule.forecastDate)}</dd>
      </dl>
      {schedule.forecastDate && schedule.differenceDays !== null && <p className="mt-3">{schedule.differenceDays === 0 ? "Forecast matches the official target." : `${Math.abs(schedule.differenceDays)} calendar days ${schedule.differenceDays > 0 ? "beyond" : "before"} the official target.`}</p>}
      <p className="mt-2 text-zinc-300">{schedule.reason}</p>
      <p className="mt-2 text-xs text-zinc-400">Calculated from the records reviewed above. Forecasts do not change planned dates.</p>
    </section>}
    <section>
      <h3 className="text-base font-semibold text-zinc-100">Potential Risks and Recommendations</h3>
      {data.findings.length ? <ol className="mt-3 list-decimal space-y-5 pl-6">
        {data.findings.map(finding=><li key={finding.id}>
          <p>
            <strong className="text-zinc-100">{finding.title}:</strong> {finding.evidence}
          </p>
          <p className="mt-2 pl-4"><strong className="text-zinc-100">Recommendation:</strong> {finding.recommendation}</p>
        </li>)}
      </ol> : <p className="mt-3 text-zinc-300">No specific concerns were identified in the saved records reviewed.</p>}
    </section>
    <p className="border-t border-white/10 pt-4 text-xs text-zinc-400">Based on saved project records as of {data.asOfDate}. Review these suggestions before making project decisions.</p>
  </article>;
}
