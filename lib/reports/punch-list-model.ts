export const PUNCH_ISSUE_TYPES = ["incomplete", "defective", "damaged", "plan_deviation", "cleanup", "safety"] as const;
export const PUNCH_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const PUNCH_STATUSES = ["open", "closed"] as const;

export type PunchIssueType = typeof PUNCH_ISSUE_TYPES[number];
export type PunchPriority = typeof PUNCH_PRIORITIES[number];
export type PunchStatus = typeof PUNCH_STATUSES[number];

export type PunchItem = {
  id: number;
  project_id: number;
  title: string;
  description: string;
  area: string;
  specific_location: string;
  related_work_key: string;
  related_work_name: string;
  issue_type: PunchIssueType;
  priority: PunchPriority;
  status: PunchStatus;
  responsible_trade: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  identified_on: string;
  due_date: string | null;
  correction_notes: string;
  verification_notes: string;
  before_photo_url: string;
  before_photo_path: string;
  after_photo_url: string;
  after_photo_path: string;
  identified_by: string;
  identified_by_name: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export const ISSUE_TYPE_LABELS: Record<PunchIssueType, string> = {
  incomplete: "Incomplete work",
  defective: "Defective work",
  damaged: "Damaged work",
  plan_deviation: "Does not match plans",
  cleanup: "Cleanup",
  safety: "Safety concern",
};

export const PUNCH_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  in_progress: "Open",
  ready_for_inspection: "Open",
  resolved: "Closed",
  reopened: "Open",
};
