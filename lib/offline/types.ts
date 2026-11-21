import type { ProgressLogDraft } from "@/lib/progress-logs/draft";

export type OfflineInput = ProgressLogDraft;
export type OfflineState = { version: string | null; input: OfflineInput; totalQuantity: number };
export type OfflineItem = {
  key: string; kind: "task" | "category"; id: number; name: string; phase: string;
  quantity: number; unit: string; startDate: string | null; endDate: string | null;
  materials: { name: string; unit: string | null }[];
  equipment: { name: string; amount: number }[];
  other: { name: string; amount: number }[];
  workerIds: number[];
};
export type OfflineProject = {
  id: number; name: string; ownerId: string; ownerName: string; preparedAt: string; workDate: string;
  items: OfflineItem[];
  workers: { id: number; name: string; rate: number; subcontractor: boolean; title?: string | null; company?: string | null }[];
  materialStocks?: { name: string; unit: string; purchased: number; used: number; balance: number; status: string; unitCost: number }[];
  states: Record<string, OfflineState>;
};
export type OfflineSubmission = {
  id: string; ownerId: string; projectId: number; kind: "task" | "category"; itemId: number;
  workDate: string; capturedAt: string; expectedVersion: string | null; input: OfflineInput;
  status: "pending" | "syncing" | "synced" | "needs-review" | "auth-required";
  error?: string; attempted?: boolean; synchronizedAt?: string;
};
