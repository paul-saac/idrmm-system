import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/projects/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { getProjectProgress } from "@/lib/progress/data";
import { buildCloseoutWork, type CloseoutRecord } from "./closeout-model";

export async function getCloseoutReport(projectId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  const supabase = await createClient();
  const [estimate, saved] = await Promise.all([
    getCostEstimate(projectId),
    supabase.from("project_closeout_reports").select("*").eq("project_id", projectId).maybeSingle(),
  ]);
  // Only a missing migration is tolerated; other failures must not look like a blank draft.
  const storageAvailable = !saved.error;
  if (saved.error && !["42P01", "PGRST205"].includes(saved.error.code)) throw new Error("Could not load the saved closeout report.");
  const progress = await getProjectProgress(projectId, estimate.categories);
  const record = saved.data as CloseoutRecord | null;
  let savedBy: string | null = null;
  if (record?.updated_by) {
    const { data: profile } = await supabase.from("profiles").select("first_name, last_name").eq("id", record.updated_by).maybeSingle();
    savedBy = profile ? `${profile.first_name} ${profile.last_name}`.trim() : null;
  }
  return {
    project, progressPercent: progress.overallPercent,
    work: buildCloseoutWork(estimate.categories, []),
    record, savedBy, storageAvailable,
    asOf: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
  };
}

export type CloseoutReportData = NonNullable<Awaited<ReturnType<typeof getCloseoutReport>>>;
