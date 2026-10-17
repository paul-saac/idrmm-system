import { materialKey } from "@/lib/task-progress/calculate";
import type {
  MaterialBreakdownEntry,
  ProgressMaterialUsage,
  ProjectMaterial,
} from "@/lib/materials/data";

/** Where a material stands against its plan — the Material record
 * table's status. */
export type MaterialRecordStatus =
  /** Planned, nothing logged as used yet. */
  | "not_used"
  /** Planned, some of it used. */
  | "in_use"
  /** Planned, all of it used. */
  | "fully_used"
  /** Planned, more used than planned. */
  | "over_plan"
  /** Not planned on any task, but used. */
  | "not_on_list"
  /** Only a stock record — not planned, not used. */
  | "stock_only";

/** One task (or task-less phase) a material is planned or used on. */
export type MaterialRecordItem = {
  key: string;
  name: string;
  planned: number;
  /** The estimate's amount for what's planned here. */
  budget: number;
  used: number;
  spent: number;
  lastUsed: string | null;
};

/** One material in the project — each name and unit once — with what's
 * planned of it, what's been logged as used, its stock, and where. */
export type MaterialRecord = {
  key: string;
  name: string;
  unit: string | null;
  /** Planned across every task's Material Breakdown. */
  planned: number;
  /** The estimate's amount for all of that. */
  budget: number;
  /** Logged as used in progress so far (saved days only). */
  used: number;
  /** What that came to: a planned use at its task's estimate price, one
   * not on the list at the unit cost typed for it. */
  spent: number;
  /** How much of `used` wasn't on the task's list. */
  usedNotOnList: number;
  /** The newest day it was used (YYYY-MM-DD). */
  lastUsed: string | null;
  /** Its stock records (Add Material), if any. */
  stock: ProjectMaterial[];
  /** Each task (or task-less phase) it's planned or used on. */
  items: MaterialRecordItem[];
  status: MaterialRecordStatus;
};

// Quantities are compared to the hundredth, the precision they're typed to.
const EPSILON = 0.005;

/**
 * Every material the project has, each name and unit once — from its
 * estimate's material lines (planned), its progress logs (used, planned
 * or not on the list), and its stock records — alphabetical. What the
 * Materials tab's Material record table lists, and what its Total
 * Material counts.
 */
export function buildMaterialRecords(
  stock: readonly ProjectMaterial[],
  planned: readonly MaterialBreakdownEntry[],
  usage: readonly ProgressMaterialUsage[]
): MaterialRecord[] {
  const records = new Map<string, MaterialRecord>();
  const items = new Map<string, Map<string, MaterialRecordItem>>();

  function recordFor(name: string, unit: string | null): MaterialRecord {
    const key = materialKey(name, unit);
    let record = records.get(key);
    if (!record) {
      record = {
        key,
        name: name.trim(),
        unit,
        planned: 0,
        budget: 0,
        used: 0,
        spent: 0,
        usedNotOnList: 0,
        lastUsed: null,
        stock: [],
        items: [],
        status: "not_used",
      };
      records.set(key, record);
      items.set(key, new Map());
    }
    return record;
  }

  function itemFor(record: MaterialRecord, key: string, name: string): MaterialRecordItem {
    const byKey = items.get(record.key)!;
    let item = byKey.get(key);
    if (!item) {
      item = { key, name, planned: 0, budget: 0, used: 0, spent: 0, lastUsed: null };
      byKey.set(key, item);
    }
    return item;
  }

  // Planned first, so every use below can be priced from it.
  for (const line of planned) {
    if (!line.materialName.trim()) continue;
    const record = recordFor(line.materialName, line.unit);
    record.planned += line.plannedQuantity;
    record.budget += line.amount;
    const item = itemFor(
      record,
      line.itemKey,
      line.taskName ? `${line.categoryName} - ${line.taskName}` : line.categoryName
    );
    item.planned += line.plannedQuantity;
    item.budget += line.amount;
  }

  for (const use of usage) {
    if (!use.materialName.trim()) continue;
    const record = recordFor(use.materialName, use.unit);
    const item = itemFor(record, use.itemKey, use.itemName);
    // Not on the list: its own unit cost. Planned: its task's estimate
    // price, else the material's across the project.
    const price =
      use.unitCost !== null
        ? use.unitCost
        : item.planned > 0
          ? item.budget / item.planned
          : record.planned > 0
            ? record.budget / record.planned
            : 0;
    const cost = use.quantity * price;
    record.used += use.quantity;
    record.spent += cost;
    item.used += use.quantity;
    item.spent += cost;
    if (use.unitCost !== null) record.usedNotOnList += use.quantity;
    if (!record.lastUsed || use.entryDate > record.lastUsed) record.lastUsed = use.entryDate;
    if (!item.lastUsed || use.entryDate > item.lastUsed) item.lastUsed = use.entryDate;
  }

  for (const material of stock) {
    const record = recordFor(material.materialName, material.unit);
    record.stock.push(material);
  }

  for (const record of records.values()) {
    record.items = Array.from(items.get(record.key)!.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    record.status =
      record.planned > 0
        ? record.used <= EPSILON
          ? "not_used"
          : record.used > record.planned + EPSILON
            ? "over_plan"
            : record.used >= record.planned - EPSILON
              ? "fully_used"
              : "in_use"
        : record.used > EPSILON
          ? "not_on_list"
          : "stock_only";
  }

  return Array.from(records.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || (a.unit ?? "").localeCompare(b.unit ?? "")
  );
}
