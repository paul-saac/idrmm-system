export const DISCIPLINES = ["Architectural", "Structural", "Electrical", "Plumbing", "Mechanical", "Civil", "General"] as const;
export const DOCUMENT_TYPES = {
  drawing: "Construction Drawings", bom: "Bill of Materials (BOM)",
  cost_estimate: "Cost Estimate", specifications: "Technical Specifications", other: "Other Supporting Documents",
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;
export type Sheet = {
  id: number; project_id: number; sheet_number: string; title: string; discipline: string;
  document_type: DocumentType;
  revision: number; stage: "original" | "revision" | "as_built"; file_path: string; file_name: string;
  evidence_path: string | null; external_name: string | null; external_role: string | null; approval_date: string | null;
  change_notes: string; status: "submitted" | "accepted" | "changes_requested" | "rejected";
  submitted_by: string; submitted_name: string; created_at: string;
  reviewed_by: string | null; reviewed_name: string | null; reviewed_at: string | null; review_notes: string | null;
};
export type SheetReview = { id: number; sheet_id: number; status: string; notes: string; reviewer_name: string; created_at: string };
export const SHEET_STATUS = { submitted: "Submitted for review", accepted: "Accepted for project records", changes_requested: "Changes requested", rejected: "Rejected" };

export function readSheetMetadata(form: FormData) {
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const sheet_number = value("sheet_number").toUpperCase();
  const title = value("title");
  const document_type = value("document_type") || "drawing";
  if (!Object.hasOwn(DOCUMENT_TYPES, document_type)) throw new Error("Choose a valid document category.");
  const discipline = value("discipline");
  const stage = value("stage");
  const change_notes = value("change_notes");
  const external_name = value("external_name");
  const external_role = value("external_role");
  const approval_date = value("approval_date");
  if (!sheet_number || sheet_number.length > 80 || !title || title.length > 200) throw new Error("Enter a sheet number (up to 80 characters) and title (up to 200).");
  if (!DISCIPLINES.includes(discipline as typeof DISCIPLINES[number])) throw new Error("Choose a drawing discipline.");
  if (!["original", "revision", "as_built"].includes(stage)) throw new Error("Choose a valid drawing type.");
  if (document_type !== "drawing" && stage === "as_built") throw new Error("As-built applies only to construction drawings.");
  if (change_notes.length > 5000 || (stage !== "original" && !change_notes)) throw new Error("Describe the field changes or confirm no changes (up to 5,000 characters).");
  if (external_name.length > 200 || external_role.length > 200) throw new Error("Professional details must be under 200 characters.");
  if (approval_date && (!/^\d{4}-\d{2}-\d{2}$/.test(approval_date) || Number.isNaN(Date.parse(approval_date)) || new Date(approval_date).toISOString().slice(0, 10) !== approval_date)) throw new Error("Enter a valid approval date.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (approval_date && approval_date > today) throw new Error("Approval date cannot be in the future.");
  return { sheet_number, title, document_type: document_type as DocumentType, discipline, stage: stage as Sheet["stage"], change_notes, external_name: external_name || null, external_role: external_role || null, approval_date: approval_date || null };
}
