export const QUALITY_INSPECTION_TYPES = [
  "architectural", "structural", "electrical", "plumbing", "mechanical", "fire_safety", "materials", "other",
] as const;
export type QualityInspectionType = typeof QUALITY_INSPECTION_TYPES[number];

export const QUALITY_INSPECTION_TYPE_LABELS: Record<QualityInspectionType, string> = {
  architectural: "Architectural",
  structural: "Structural",
  electrical: "Electrical",
  plumbing: "Plumbing",
  mechanical: "Mechanical",
  fire_safety: "Fire safety",
  materials: "Materials testing",
  other: "Other",
};

export const QUALITY_RESULTS = ["pending", "passed", "failed", "conditional", "reinspection_required"] as const;
export type QualityResult = typeof QUALITY_RESULTS[number];
export const QUALITY_RESULT_LABELS: Record<QualityResult, string> = {
  pending: "Pending result",
  passed: "Passed",
  failed: "Failed",
  conditional: "Conditional acceptance",
  reinspection_required: "Reinspection required",
};

export const QUALITY_AUTHORITY_TYPES = ["architect", "engineer", "testing_laboratory", "local_authority", "third_party_inspector"] as const;
export type QualityAuthorityType = typeof QUALITY_AUTHORITY_TYPES[number];
export const QUALITY_AUTHORITY_TYPE_LABELS: Record<QualityAuthorityType, string> = {
  architect: "Architect",
  engineer: "Engineer",
  testing_laboratory: "Testing laboratory",
  local_authority: "Local authority",
  third_party_inspector: "Third-party inspector",
};

export type QualityInspection = {
  id: number;
  project_id: number;
  inspection_type: QualityInspectionType;
  inspection_scope: string;
  authority_type: QualityAuthorityType;
  certificate_number: string;
  issued_on: string | null;
  standard_reference: string;
  nonconformance_description: string;
  corrective_action_required: string;
  punch_item_id: number | null;
  reinspection_reference: string;
  related_work_key: string;
  related_work_name: string;
  area: string;
  inspected_on: string;
  inspector_name: string;
  inspector_role: string;
  inspector_organization: string;
  license_number: string;
  result: QualityResult;
  remarks: string;
  test_name: string;
  acceptance_criteria: string;
  actual_result: string;
  result_unit: string;
  related_sheet_id: number | null;
  recorded_by: string;
  recorded_by_name: string | null;
  created_at: string;
  updated_at: string;
};
