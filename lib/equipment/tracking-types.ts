export type EquipmentTracking = {
  equipment: { id: number; name: string; assetTag: string; status: string; currentProjectId: number | null; currentItemKey: string | null; location: string }[];
  plans: { itemKey: string; equipmentId: number; name: string; assetTag: string }[];
};
