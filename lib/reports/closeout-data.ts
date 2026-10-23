import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { getProjectById } from "@/lib/projects/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { getProjectProgress } from "@/lib/progress/data";
import { listProgressExpenses, listProjectEquipmentAssignments } from "@/lib/equipment/data";
import type { Sheet } from "@/lib/sheets/model";
import { listPunchItems } from "./punch-list-data";
import { listQualityInspections } from "./quality-inspection-data";
import { listProjectIncidents } from "@/lib/incidents/data";
import {
  buildCloseoutWork,
  buildCloseoutDeliverables,
  buildCloseoutCostBaseline,
  type CloseoutRecord,
} from "./closeout-model";

export async function getCloseoutReport(projectId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  const supabase = await createClient();
  const [estimate, saved, sheetsResult, expenses, equipmentAssignments, punchList, qualityInspections, safetyIncidents, sessionProfile] = await Promise.all([
    getCostEstimate(projectId),
    supabase.from("project_closeout_reports").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_sheets").select("*").eq("project_id", projectId).order("sheet_number", { ascending: true }).order("revision", { ascending: true }),
    listProgressExpenses(projectId),
    listProjectEquipmentAssignments(projectId),
    listPunchItems(projectId),
    listQualityInspections(projectId),
    listProjectIncidents(projectId),
    getSessionProfile(),
  ]);
  // Only a missing migration is tolerated; other failures must not look like a blank draft.
  const storageAvailable = !saved.error;
  if (saved.error && !["42P01", "PGRST205"].includes(saved.error.code)) throw new Error("Could not load the saved closeout report.");
  const sheetsAvailable = !sheetsResult.error;
  if (sheetsResult.error && !["42P01", "PGRST205"].includes(sheetsResult.error.code)) throw new Error("Could not load project sheets for reporting.");
  const progress = await getProjectProgress(projectId, estimate.categories);
  const record = saved.data as CloseoutRecord | null;
  const sheets = (sheetsResult.data ?? []) as Sheet[];
  let savedBy: string | null = null;
  if (record?.updated_by) {
    const { data: profile } = await supabase.from("profiles").select("first_name, last_name").eq("id", record.updated_by).maybeSingle();
    savedBy = profile ? `${profile.first_name} ${profile.last_name}`.trim() : null;
  }
  return {
    project,
    progressPercent: progress.overallPercent,
    work: buildCloseoutWork(estimate.categories, expenses),
    deliverables: buildCloseoutDeliverables(estimate.categories, expenses),
    costBaseline: buildCloseoutCostBaseline(estimate.summary.totalsByColumn, expenses, project.allocatedBudget),
    expenses,
    equipmentAssignments,
    record,
    savedBy,
    storageAvailable,
    sheets,
    sheetsAvailable,
    punchItems: punchList.items,
    punchListAvailable: punchList.available,
    qualityInspections: qualityInspections.items,
    qualityInspectionsAvailable: qualityInspections.available,
    safetyIncidents: safetyIncidents.items,
    safetyIncidentsAvailable: safetyIncidents.available,
    generatedBy: sessionProfile
      ? `${sessionProfile.firstName} ${sessionProfile.lastName}`.trim() || sessionProfile.email || "Authorized user"
      : "Authorized user",
    asOf: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
  };
}

export type CloseoutReportData = NonNullable<Awaited<ReturnType<typeof getCloseoutReport>>>;
