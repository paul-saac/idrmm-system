"use server";

import { requireProjectAccess } from "@/lib/auth/project-access";
import { revalidateProjectPaths, revalidateReports } from "@/lib/projects/revalidate";
import { createClient } from "@/lib/supabase/server";
import { QUALITY_AUTHORITY_TYPES, QUALITY_INSPECTION_TYPES, QUALITY_RESULTS, type QualityAuthorityType, type QualityInspectionType, type QualityResult } from "./quality-inspection-model";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);

export async function saveQualityInspection(projectId: number, form: FormData) {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "Project access denied." };
    const client = await createClient();
    const inspectionId = Number(form.get("inspectionId") ?? 0);
    const inspectionType = String(form.get("inspectionType") ?? "") as QualityInspectionType;
    const authorityType = String(form.get("authorityType") ?? "") as QualityAuthorityType;
    const result = String(form.get("result") ?? "") as QualityResult;
    const inspectionScope = text(form, "inspectionScope", 300);
    const area = text(form, "area", 200);
    const inspectedOn = String(form.get("inspectedOn") ?? "");
    const issuedOn = String(form.get("issuedOn") ?? "");
    const inspectorName = text(form, "inspectorName", 200);
    const nonconformanceDescription = text(form, "nonconformanceDescription", 5000);
    const correctiveActionRequired = text(form, "correctiveActionRequired", 5000);
    const relatedSheetIdRaw = String(form.get("relatedSheetId") ?? "");
    const relatedSheetId = relatedSheetIdRaw ? Number(relatedSheetIdRaw) : null;
    const punchItemIdRaw = String(form.get("punchItemId") ?? "");
    const punchItemId = punchItemIdRaw ? Number(punchItemIdRaw) : null;
    if (!QUALITY_INSPECTION_TYPES.includes(inspectionType) || !QUALITY_AUTHORITY_TYPES.includes(authorityType) || !QUALITY_RESULTS.includes(result)) return { error: "Select a valid inspection type, authority, and result." };
    if (!inspectionScope || !area || !inspectorName || !datePattern.test(inspectedOn)) return { error: "Enter the inspection scope, area, date, and inspector name." };
    if (issuedOn && !datePattern.test(issuedOn)) return { error: "Enter a valid certificate issue date." };
    if (["failed", "conditional", "reinspection_required"].includes(result) && (!nonconformanceDescription || !correctiveActionRequired)) {
      return { error: "Record the nonconformance and required corrective action for this inspection result." };
    }
    if (relatedSheetId != null && (!Number.isSafeInteger(relatedSheetId) || relatedSheetId <= 0)) return { error: "Select a valid supporting document." };
    if (punchItemId != null && (!Number.isSafeInteger(punchItemId) || punchItemId <= 0)) return { error: "Select a valid punch-list item." };
    if (relatedSheetId != null) {
      const { data: sheet } = await client.from("project_sheets").select("id, status").eq("id", relatedSheetId).eq("project_id", projectId).maybeSingle();
      if (!sheet) return { error: "The selected supporting document does not belong to this project." };
      if (sheet.status !== "accepted") return { error: "Select a supporting document that has been accepted for project records." };
    }
    if (punchItemId != null) {
      const { data: punchItem } = await client.from("project_punch_items").select("id").eq("id", punchItemId).eq("project_id", projectId).maybeSingle();
      if (!punchItem) return { error: "The selected punch-list item does not belong to this project." };
    }
    const values = {
      inspection_type: inspectionType,
      inspection_scope: inspectionScope,
      authority_type: authorityType,
      certificate_number: text(form, "certificateNumber", 150),
      issued_on: issuedOn || null,
      standard_reference: text(form, "standardReference", 500),
      nonconformance_description: nonconformanceDescription,
      corrective_action_required: correctiveActionRequired,
      punch_item_id: punchItemId,
      reinspection_reference: text(form, "reinspectionReference", 150),
      related_work_key: text(form, "relatedWorkKey", 80),
      related_work_name: text(form, "relatedWorkName", 200),
      area,
      inspected_on: inspectedOn,
      inspector_name: inspectorName,
      inspector_role: text(form, "inspectorRole", 200),
      inspector_organization: text(form, "inspectorOrganization", 200),
      license_number: text(form, "licenseNumber", 120),
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
      return { error: "Could not save the inspection. Check migration 0093 and try again." };
    }
    revalidateReports();
    revalidateProjectPaths(projectId);
    return { success: true };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Could not save the inspection." };
  }
}
