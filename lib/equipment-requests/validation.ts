export function equipmentRequestIssue(date: string, items: { equipmentName: string; quantityNeeded: string | number; uom: string; purpose: string }[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)))
    return { message: "Pick the date the equipment is required.", field: "dateRequired", index: -1 };
  if (!items.length) return { message: "Add at least one equipment item to the request.", field: "name", index: -1 };
  for (const [index, item] of items.entries()) {
    const label = `item ${index + 1}${item.equipmentName.trim() ? ` (${item.equipmentName.trim()})` : ""}`;
    if (!item.equipmentName.trim()) return { message: `Enter an equipment name for ${label}.`, field: "name", index };
    if (!Number.isFinite(Number(item.quantityNeeded)) || Number(item.quantityNeeded) <= 0)
      return { message: `Enter a quantity greater than zero for ${label}.`, field: "qty", index };
    if (!item.uom.trim()) return { message: `Select or enter a unit for ${label}.`, field: "uom", index };
    if (!item.purpose.trim()) return { message: `Enter the purpose of request for ${label}.`, field: "purpose", index };
  }
  return null;
}
