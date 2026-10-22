export type EquipmentOperation = {
  id: string;
  itemKey: string;
  equipmentId: number;
  action: "plan" | "unplan" | "deploy" | "transfer" | "return" | "used";
  entryDate: string;
  destination?: string;
  notes?: string;
};
export type EquipmentTracking = {
  equipment: { id: number; name: string; assetTag: string; status: string; currentProjectId: number | null; currentItemKey: string | null; location: string }[];
  plans: { itemKey: string; equipmentId: number; name: string; assetTag: string }[];
  events: { id: string; itemKey: string; destinationKey: string | null; equipmentId: number; name: string; assetTag: string; action: string; entryDate: string; from: string; to: string; notes: string | null; recordedAt: string; recordedBy: string }[];
};
export function equipmentToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}
