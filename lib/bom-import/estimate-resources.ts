export type ImportCostType = "material" | "labor" | "equipment" | "other";
export type ImportCostLine = { itemNo?: string; name: string; amount: string };
export type ImportMaterial = { itemNo?: string; name: string; quantity: string; unit: string; unitCost: string; amount?: string };
export type ImportResources = {
  itemNo?: string;
  amount?: string;
  amountType?: ImportCostType;
  laborEstimate?: string;
  materials?: ImportMaterial[];
  equipment?: ImportCostLine[];
  otherCosts?: ImportCostLine[];
};

export function importNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(number) && number >= 0 && number < 1e12 ? number : null;
}

/** Missing values stay unknown in the draft. Only known values contribute. */
export function importResourceTotals(owner: ImportResources) {
  const material = (owner.materials ?? []).reduce((sum, line) => sum + (importNumber(line.amount) ?? (importNumber(line.quantity) ?? 0) * (importNumber(line.unitCost) ?? 0)), 0);
  const totals = {
    material, labor: importNumber(owner.laborEstimate) ?? 0,
    equipment: (owner.equipment ?? []).reduce((sum, line) => sum + (importNumber(line.amount) ?? 0), 0),
    other: (owner.otherCosts ?? []).reduce((sum, line) => sum + (importNumber(line.amount) ?? 0), 0),
  };
  totals[owner.amountType ?? "material"] += importNumber(owner.amount) ?? 0;
  return { ...totals, total: totals.material + totals.labor + totals.equipment + totals.other };
}

export function validImportResources(owner: ImportResources) {
  const valid = (value: string | undefined) => value === undefined || value.trim() === "" || importNumber(value) !== null;
  return (!owner.amountType || ["material", "labor", "equipment", "other"].includes(owner.amountType)) &&
    valid(owner.amount) && valid(owner.laborEstimate) &&
    (owner.materials ?? []).every(line => line.name.trim().length > 0 && valid(line.quantity) && valid(line.unitCost) && valid(line.amount)) &&
    [...(owner.equipment ?? []), ...(owner.otherCosts ?? [])].every(line => line.name.trim().length > 0 && line.name.length <= 200 && valid(line.amount)) &&
    Object.values(importResourceTotals(owner)).every(total => Number.isFinite(total) && total < 1e15);
}
