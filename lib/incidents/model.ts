export const INCIDENT_TYPES = {
  injury: "Injury", near_miss: "Near miss", equipment_damage: "Equipment damage",
  property_damage: "Property damage", other: "Other",
} as const;
export const INCIDENT_SEVERITIES = { minor: "Minor", moderate: "Moderate", serious: "Serious" } as const;
export type IncidentContext = { kind: "task" | "category"; id: number; name: string };
export type IncidentAttachment = { path: string; name: string; type: string; size: number; url?: string | null };
export type Incident = {
  id: number; project_id: number; task_id: number | null; category_id: number | null;
  context_name: string; log_date: string; incident_type: keyof typeof INCIDENT_TYPES;
  severity: keyof typeof INCIDENT_SEVERITIES; occurred_on: string; occurred_time: string;
  location: string; description: string; attachments: IncidentAttachment[];
  reported_by: string; reporter_name: string; created_at: string;
};
export const MAX_INCIDENT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INCIDENT_TOTAL_BYTES = 15 * 1024 * 1024;
export const MAX_INCIDENT_FILES = 5;
export const INCIDENT_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];

export function validateIncidentFiles(files: { name: string; size: number; type: string }[]): string | null {
  if (files.length > MAX_INCIDENT_FILES) return "Attach up to 5 photos or documents.";
  for (const file of files) {
    if (!INCIDENT_MIME_TYPES.includes(file.type)) return "Use JPG, PNG, or PDF files.";
    if (!file.size || file.size > MAX_INCIDENT_FILE_BYTES) return "Each attachment must be between 1 byte and 10 MB.";
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_INCIDENT_TOTAL_BYTES) return "Attachments must total 15 MB or less.";
  return null;
}

export function isIncidentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
