export type EquipmentTracking = {
  equipment: { id: number; name: string; assetTag: string; status: string; currentProjectId: number | null; currentItemKey: string | null; location: string;
    allocations?: { projectId: number; projectName: string; itemKey: string; startDate: string | null; endDate: string | null }[];
  }[];
  plans: { itemKey: string; equipmentId: number; name: string; assetTag: string }[];
  /** Only conflict flags; other projects' protected records are not included. */
  conflicts?: { itemKey: string; equipmentId: number }[];
};

export type EquipmentConflict = {
  equipment: string;
  projectName: string | null;
  task: string;
  startDate: string | null;
  endDate: string | null;
};
