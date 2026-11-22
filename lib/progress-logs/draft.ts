import type { recordTaskProgress } from "@/lib/task-progress/actions";

export type ProgressLogDraft = Parameters<typeof recordTaskProgress>[2];

/** Compare entered values, not row order, input formatting or empty added rows. */
export function progressLogDraftKey(draft: ProgressLogDraft & { photoFiles?: readonly { name: string; size: number; lastModified: number }[] }) {
  const sorted = (rows: unknown[][]) => rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const costs = (rows: {name:string;amount:number}[] = []) => sorted(rows.filter(row=>row.amount!==0).map(row=>[row.name.trim(),row.amount]));
  return JSON.stringify({
    remarks: draft.remarks?.trim() ?? "",
    photos: sorted((draft.photos ?? []).map(photo=>[photo.path])),
    photoFiles: (draft.photoFiles ?? []).map(file=>[file.name,file.size,file.lastModified]),
    quantity: draft.quantityCompletedToday,
    costs: [draft.costs.labor,draft.costs.material,draft.costs.equipment,draft.costs.other],
    materials: sorted(draft.materialsUsed.filter(row=>row.quantity!==0).map(row=>[row.name.trim(),row.unit?.trim() || null,row.quantity])),
    unplannedMaterials: sorted((draft.unplannedMaterials ?? []).filter(row=>row.quantity!==0).map(row=>[row.name.trim(),row.unit?.trim() || null,row.quantity,row.unitCost])),
    equipment: costs(draft.equipmentCostsUsed),
    unplannedEquipment: costs(draft.unplannedEquipmentCosts),
    other: costs(draft.otherCostsUsed),
    unplannedOther: costs(draft.unplannedOtherCosts),
    attendance: sorted((draft.attendance ?? []).filter(row=>row.hours!==0 || (row.amount ?? 0)!==0).map(row=>[row.workerId,row.hours,...(row.amount != null ? [row.amount] : [])])),
  });
}
