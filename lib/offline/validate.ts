import type { OfflineSubmission } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e12;
const text = (value: unknown, max = 200) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const rows = (value: unknown, check: (row: Record<string, unknown>) => boolean) =>
  value === undefined || Array.isArray(value) && value.length <= 500 && value.every(row => row && typeof row === "object" && check(row));

export function validOfflineSubmission(value: unknown): value is OfflineSubmission {
  if (!value || typeof value !== "object") return false;
  const v = value as OfflineSubmission;
  if (!uuid.test(v.id) || !uuid.test(v.ownerId) || !Number.isSafeInteger(v.projectId) || v.projectId <= 0 ||
    !Number.isSafeInteger(v.itemId) || v.itemId <= 0 || !["task", "category"].includes(v.kind) ||
    typeof v.workDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.workDate) ||
    !Number.isFinite(Date.parse(v.workDate)) || new Date(v.workDate).toISOString().slice(0, 10) !== v.workDate ||
    typeof v.capturedAt !== "string" || !Number.isFinite(Date.parse(v.capturedAt)) ||
    !(v.expectedVersion === null || typeof v.expectedVersion === "string" && /^[a-f0-9]{32}$/.test(v.expectedVersion))) return false;
  const input = v.input;
  if (!input || !number(input.quantityCompletedToday) || !input.costs ||
    ![input.costs.labor, input.costs.material, input.costs.equipment, input.costs.other].every(number)) return false;
  const material = (r: Record<string, unknown>) => text(r.name) && (r.unit === null || typeof r.unit === "string" && r.unit.length <= 40) && number(r.quantity);
  const cost = (r: Record<string, unknown>) => text(r.name) && number(r.amount);
  return rows(input.materialsUsed, material) && rows(input.unplannedMaterials, r => material(r) && number(r.unitCost)) &&
    rows(input.equipmentCostsUsed, cost) && rows(input.unplannedEquipmentCosts, cost) &&
    rows(input.otherCostsUsed, cost) && rows(input.unplannedOtherCosts, cost) && rows(input.attendance, r =>
      Number.isSafeInteger(r.workerId) && Number(r.workerId) > 0 && number(r.hours) && Number(r.hours) <= 24 &&
      (r.amount === undefined || number(r.amount) && r.amount > 0 && r.hours === 0));
}
