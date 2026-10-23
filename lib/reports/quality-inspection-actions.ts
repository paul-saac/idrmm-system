"use server";

import { requireProjectAccess } from "@/lib/auth/project-access";
import { revalidateProjectPaths, revalidateReports } from "@/lib/projects/revalidate";
import { createClient } from "@/lib/supabase/server";
import { QUALITY_INSPECTION_TYPES, QUALITY_RESULTS, type QualityInspectionType, type QualityResult } from "./quality-inspection-model";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);

export async function saveQualityInspection(projectId: number, form: FormData) {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "Project access denied." };
    const client = await createClient();
    const inspectionId = Number(form.get("inspectionId") ?? 0);
    const inspectionType = String(form.get("inspectionType") ?? "") as QualityInspectionType;
    const result = String(form.get("result") ?? "") as QualityResult;
    const inspectionScope = text(form, "inspectionScope", 300);
    const area = text(form, "area", 200);
    const inspectedOn = String(form.get("inspectedOn") ?? "");
    const inspectorName = text(form, "inspectorName", 200);
    const relatedSheetIdRaw = String(form.get("relatedSheetId") ?? "");
    const relatedSheetId = relatedSheetIdRaw ? Number(relatedSheetIdRaw) : null;
    if (!QUALITY_INSPECTION_TYPES.includes(inspectionType) || !QUALITY_RESULTS.includes(result)) return { error: "Select a valid inspection type and result." };
    if (!inspectionScope || !area || !inspectorName || !datePattern.test(inspectedOn)) return { error: "Enter the inspection scope, area, date, and inspector name." };
    if (relatedSheetId != null && (!Number.isSafeInteger(relatedSheetId) || relatedSheetId <= 0)) return { error: "Select a valid supporting document." };
    if (relatedSheetId != null) {
      const { data: sheet } = await client.from("project_sheets").select("id, status").eq("id", relatedSheetId).eq("project_id", projectId).maybeSingle();
      if (!sheet) return { error: "The selected supporting document does not belong to this project." };
      if (sheet.status !== "accepted") return { error: "Select a supporting document that has been accepted for project records." };
    }
    const values = {
      inspection_type: inspectionType,
      inspection_scope: inspectionScope,
      area,
      inspected_on: inspectedOn,
      inspector_name: inspectorName,
      inspector_organization: text(form, "inspectorOrganization", 200),
      result,
      remarks: text(form, "remarks", 5000),
      test_name: text(form, "testName", 200),
      acceptance_criteria: text(form, "acceptanceCriteria", 500),
      actual_result: text(form, "actualResult", 500),
      result_unit: text(form, "resultUnit", 50),
      related_sheet_id: relatedSheetId,
    };
    const query = inspectionId > 0
      ? client.from("project_quality_inspections").update(values).eq("id", inspectionId).eq("project_id", projectId)
      : client.from("project_quality_inspections").insert({ ...values, project_id: projectId, recorded_by: profile.id });
    const { error } = await query;
    if (error) {
      console.error("[saveQualityInspection]", error);
      if (["42P01", "PGRST205"].includes(error.code)) {
        return { error: "Inspection storage is missing. Apply migration 0093 in this project's Supabase database." };
      }
      if (["42703", "PGRST204"].includes(error.code) && error.message.includes("inspection_scope")) {
        return { error: "The Work inspected field is not set up yet. Apply migration 0094_quality_inspection_certificate_fields.sql in Supabase SQL Editor, then try again." };
      }
      if (error.code === "42501") {
        return { error: "You do not have permission to save inspections for this project." };
      }
      return { error: `Could not save the inspection${error.code ? ` (${error.code})` : ""}. Ask your administrator to check the server log for details.` };
    }
    revalidateReports();
    revalidateProjectPaths(projectId);
    return { success: true };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Could not save the inspection." };
  }
}
